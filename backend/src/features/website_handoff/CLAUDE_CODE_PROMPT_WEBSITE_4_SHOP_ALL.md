# Brief: Website 4 — Shop all (`/shop`), Shop.tsx retired

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** briefs 1 and 2 (`GET /api/coffees/cards`).

Read first: `README.md` (merge rule, D3, D4, D5, D9, D12, D13), `HANDOFF_SURVEY_2026-11-04.md` §2, `frontend/src/design/CLAUDE.md` (the "never touch Shop.tsx" rule is lifted by this brief, Dana 2026-11-04 via D4), `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/shop/build.py` (the generator; read it for the data shape the card expects) and `source/shop/index.html` (the output; CSS). Media in `source/shop/media/`.

## Goal

`/shop` is the handoff "Shop all" page: intro, family menu, "Your family first", five family sections with a collection row and a 3-column card grid, plus one "Other" section (D5). Every card reads from `/api/coffees/cards`, adds to the real cart, and carries the states the design lacks (unpriced, unavailable, coming soon). `Shop.tsx` is deleted.

**Decisions already made:** OT-70 (2026-11-05): a category coffee (decaf, half-caf, flavored) gets its customer-facing name in one place for its role, as a slot coffee's name lives on its slot: Task 0 checks `coffee_category_assignment` for a customer-name column; if none exists this brief adds `customer_name text` there (comment, seed NULL, written through `catalogService`, read in `v_coffee_card`/`getCoffeeCards`), and the raw `coffees.name` is never a fallback; a category coffee with no customer name is not shown · D4 `/shop` = Shop all, `/flavor-intelligence` stays as the deep dive linked from each card ("Full profile ↗") · D5 five families + Other · D9 fields · D12 Premium ★ = award tag · D13 prices from the payload · D3 cart drawer stays; add-to-cart opens it as today.

**Guardrails.** G4.1 reuse: `usePositionCardData` (or the `/cards` payload that supersedes it, Task 0 decides which the card consumes; one source), `CardTags`, `useCart`, the dial-event sync function, `FloatingCart`, chrome primitives · G4.2 nothing typed in · G4.3 · G4.5 no roaster or award name · G4.6 route stays behind `PrelaunchGate` · G1.6. Schema: only the OT-70 column if Task 0 finds no customer-name column (G2.4, G2.17 apply). STOP: none.

## Task 0 — verify first (findings into `CLOSING_REPORT_4.md`)

1. Read `Shop.tsx` and list every import that only it uses (to delete safely) and every route/link into `/shop` (`Home`, lifecycle CTAs "Shop your matches →", emails in `backend/src/…` templates, `QrDoor`, `Profile`) — these keep working. Home (Website 3) links `/shop#<archetype code>` with the DB codes (`#floral`, `#fruity`, `#balanced_sweet`, `#chocolate_nutty`, `#earthy`); each family section's `id` is its code so those anchors land.
2. Read `DialArchetypeSection.tsx:330-400` (the live card), `usePositionCardData`, `CardTags`, the add-to-cart item shape and the `setDialPosition(..., trigger:'add_to_cart')` sync; name the function to reuse.
3. Read `/api/coffees/cards` from brief 2 and map each handoff card field to a payload field; list the ones that are NULL in production today (hint, milk, photo) so the card omits those rows.
4. Read how the collection item is built today (`kind: 'collection'`, `memberCount`, `undiscountedPriceCents`): name the function; the "Add the collection" row calls it.
5. Confirm `FlavorIntelligencePage` accepts a deep link per coffee (`?archetype=&slot=` or `/coffee/:id/story`); pick the one that opens the coffee's full profile.

## Task 0.5 — Dana's manual steps

Upload the shop photos to the `raw/` paths Part A reports. Not a pause point.

## Part A — assets

`shopAssets.family.{slug}` photos (one per family from the handoff `shop-*.jpg`, chosen as the generator assigns them) + `shopAssets.other`. A card uses `photo_asset_key` from the payload when set, else its family photo.

## Part B — the page

- **Intro** "Every coffee we cup." + lead (the "Five" from the archetype count; "roasted to order by partner roasteries" becomes "from partner roasteries", D14). **Family menu**: All + the five + Other as anchors; the current one by scroll-spy (IntersectionObserver), sticky on desktop at the top offset the header leaves (the current `Shop.tsx` sticky nav is the behaviour to keep).
- **For you line**: signed-in with a known archetype → "Your family is {name} · from your quiz" + the toggle "Your family first" (default on; persisted in `localStorage`); anonymous → the line reads "Find your family first → " linking the quiz. Section order = `archetype-order` endpoint when the toggle is on, else `sort_order`.
- **Family section** (×5, then Other): label "0N — Family of taste" / "Your family", name in the family colour, `customer_words`, collection row ("The collection · {n} coffees · {price}" where both come from the payload; "Add the collection ↗" → the collection add function), card grid 3/2/1 columns at the handoff breakpoints. Other: label "Other", the category coffees (Decaf, Half-Caf, Flavored) using the same card, no collection row, no words.
- **`ShopCoffeeCard`** (new shared component under `components/shop/`, built once, used by this page and by brief 3's featured figure if a prop fits): photo 4:3 · "The coffee" + Premium ★ when `award` + stop label · words · platform name · "Signature notes" + notes · hint (omit when null) · spec `dl` with only the rows present (Best brew, Also good, Milk, Leads in cup, Origin) · footer `{price} · {weight} oz whole bean` for the default weight, with the existing weight chips when a slot has more than one price (design has one line; render chips in `Caps` under it) · "Add to cart ↗" → `addToCart` + dial sync · "Full profile ↗" (`Caps` link, bottom-right) → the deep link Task 0 item 5 chose. States: unpriced → footer "Price coming" in `Caps`, no add; unavailable/coming soon → tinted card, "Coming soon", no add; prelaunch → no cart link, no price. Hover fill in the family colour as drawn; keyboard focus shows the same fill.
- **Retire** `Shop.tsx` and its orphan imports; update `design/CLAUDE.md` (remove the "never touch Shop.tsx" rule, note the retirement date).

## Part B2 — Home follow-up (OT-76, Dana 2026-11-05, one line)

In `Home.tsx` section 08, Liam's example answer drops the comparison: "Your answers leaned toward ripe, juicy moments over fragrant ones." → "Your answers leaned toward ripe, juicy moments." The customer's question "Why Fruity and not Floral?" stays (it is the customer's voice). Close OT-76.

## Part C — tests

vitest: sections render from a mocked payload in `sort_order`, user's family first when the toggle is on; card omits null rows; unpriced/unavailable states; Premium ★ only when `award` true and no award text anywhere in the DOM; add-to-cart calls the shared function with the dial item shape; collection row calls the collection function; gated mode hides cart and prices.

## Acceptance

Live `?preview=true`: 390/1280 screenshots of the page, one family section, one card in each state (use the test DB locally for the states production lacks); `/shop#fruity` lands on Fruity; `Home` lifecycle "Shop your matches →" still lands; drawer opens on add.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (anchors, your-family-first, card states, no roaster/award names), `OPEN_TASKS.md` (per-coffee photos for Camila; `/flavor-intelligence` chrome refresh is only tokens until a design exists), `CLOSING_REPORT_4.md`.

## Do not

- No price, word, name, count or collection total typed in.
- Do not fork the card logic from `DialArchetypeSection`; extract and share, or consume the same payload.
- Do not remove `/flavor-intelligence`, `/coffees`, or any link into `/shop`.
