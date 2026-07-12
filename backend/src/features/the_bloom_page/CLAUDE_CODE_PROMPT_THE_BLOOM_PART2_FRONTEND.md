# The Bloom — Part 2 of 2: Frontend (`BloomPage.tsx`, routing, nav)

**Prerequisite: `CLAUDE_CODE_PROMPT_THE_BLOOM_PART1_BACKEND.md` (this same folder) must be built, deployed, and its testing task completed first.** Every endpoint this file relies on (`GET /api/coffees/archetypes`, `GET /api/shop/slot-availability`, the sanitized `/:id/content`/`/:id/dimensions`/`/:id/flavor-wheel`, `GET /api/coffees/:coffeeId/hops`) is assumed to already exist and work. If any of them are missing or behave differently than documented below, stop and reconcile with Part 1 rather than guessing.

## Context

Dana's target IA for customer-facing coffee pages: **The Axis** (`/the-axis`, already built, not touched by this project) and **The Bloom** (`/bloom`, new — this two-part build). This part builds the actual page.

**Do not remove or modify `/coffees` or `/shop`.** Neither is being retired. `/coffees` stays permanently as a secondary flavor-intelligence destination (Decision #9 in Part 1). `/shop` stays because **Camila is actively working on it right now** — treat `Shop.tsx` and its images purely as a **read-only design reference** for Bloom's shell, not as a file to touch. Since it's actively being edited outside this build, don't be surprised if its exact contents have moved on by the time this runs — match the spirit of its current layout, don't assume every line will be byte-identical to what's quoted below.

This is a drop-ship model: **customers must never see roaster identity or raw internal coffee names anywhere on The Bloom**, in any UI state, including cart, checkout, and order confirmation.

**Checkout/cart UI is in scope** even though Shopify credentials aren't live yet — it should work against the existing stub the same way `POST /api/orders` already does, and start working for real the moment credentials land (see entry #77 in `WHAT_WE_BUILT.md`).

---

## Phase 2 — The Bloom (`/bloom`, `BloomPage.tsx`)

One new component. Base the visual shell on `Shop.tsx`: same archetype color palette, hero photography, bag art (`design/IMAGES/bags/...`), section layout, scroll-in motion (`motion/react`). These are static brand assets keyed by archetype id — keep them as local imports, they don't come from the DB.

Replace the hardcoded `ARCHETYPES` array with a fetch to `GET /api/coffees/archetypes` (from Part 1), merged client-side with the existing local image/color map by archetype id.

**Images: reuse Camila's exact files, unmodified — only fix how they're loaded, not what they are.** Do not recompress, resize, convert format, or otherwise touch the actual PNG files in `design/IMAGES/` — that work is deliberately deferred (see `IMAGE_PERFORMANCE_FINDINGS.md` in this same folder) and is out of scope here. What *is* in scope, and costs nothing to get right the first time: how the `<img>` tags for these files are written on the new page.

- `loading="lazy"` and `decoding="async"` on every hero/bag image **except the first archetype section** (the one visible without scrolling) — Bloom is a long scrolling page with 5-6 full-bleed archetype sections; without lazy loading, the browser fetches every section's multi-megabyte images on initial load even though the user hasn't scrolled anywhere near most of them yet. This alone meaningfully helps first-load time without touching a single image file.
- Explicit `width`/`height` (or a CSS `aspect-ratio`) on every image, matching its real dimensions, so the browser reserves the right amount of space before the image loads — prevents layout jank as large files finish downloading.
- Real `alt` text per archetype/bag image (accessibility, currently worth checking whether `Shop.tsx` already has this — carry it over if so, add it if not).
- If `Shop.tsx` is already doing some of this, match its existing pattern rather than reinventing one; the point is that `BloomPage.tsx` shouldn't regress below whatever `Shop.tsx` currently does, and should add lazy-loading if `Shop.tsx` doesn't already have it.

### Phase 2a — how Camila's shell, archetype grouping, and the flavor-intelligence layer combine

This is the part of the merge that isn't just "move the data over" — it's a real layout decision. Here's the concrete structure:

**Camila's per-archetype editorial shell is the page's outer structure and does not change.** Keep `Shop.tsx`'s `ArchetypeSection` almost exactly as-is: the alternating left/right flip layout, full-bleed hero photo, bag art, color-coded eyebrow label, archetype name, descriptor line, section dividers, scroll-in motion. This is the "grouped by archetype" browsing experience — it already does that at the archetype level. Don't rebuild it as a sidebar-driven app layout; that would throw away Camila's design, which Dana was explicit about preserving.

**Replace only the single hardcoded coffee teaser inside each section** (today: one `coffee`/`notes`/`roast`/`brew`/`price` block per archetype) **with one position card per position in that archetype's dial vocabulary** (Part 1's endpoint returns all of them, active or not — stack them if there's more than one, e.g. Lighter / Classic / Richer).

**For a position with `isActive: true`**, collapsed by default:
- Position label + platform name as the heading (e.g. "◉ Classic — Classic Chocolate")
- A one-line teaser pulled from real data instead of Camila's placeholder "notes" line — use the first sentence of `surprise_note` (via `GET /api/coffees/:coffeeId/content`, `coffeeId` from Part 1's response, never rendered) so the teaser copy is real instead of mock
- Price + weight selector, combined: for each weight (12oz, 5lb), show its own price from `prices`, but only as a selectable option where `GET /api/shop/slot-availability` returns `available: true` for that weight. If only one weight is available, don't show a selector at all — just that weight's price. If neither weight is available, this card behaves as `isActive: false` (see below).
- "Add to cart" button — **if every weight comes back `available: false`, treat the whole card as if `isActive` were false** rather than showing an Add to cart button with nothing purchasable behind it
- A "Reveal the full profile" affordance styled consistently with the site's existing progressive-disclosure language (the collapsible AI note in `CoffeesPage.tsx`, the curtain-reveal in `TasteFinderSection.tsx`/`FlavorQuiz.tsx`'s result screen — reuse that visual/motion vocabulary, don't invent a new one)

**For a position with `isActive: false` (or active but fully out of stock, per above) — Decision #3:** render the position label only (e.g. "→ Richer") with a **"Temporarily unavailable"** badge, greyed out. No platform name (there isn't one), no price, no weight selector, no cart button, no "reveal" affordance — there's no `coffeeId` to fetch an informational layer from. Don't hide the card entirely; a customer scanning an archetype section should be able to see that a bolder/lighter option normally exists there.

**Revealing a card expands it in place** (push the rest of the section down, same `motion/react` easing used elsewhere) to show the full informational layer, carried over from `CoffeesPage.tsx` with logic and ordering unchanged, just re-skinned and re-labeled with alias instead of coffee name — **do not reorder or oversize any element relative to how `CoffeesPage.tsx` presents it today** (see Decision #7 — an earlier draft of this project had proposed elevating the Collaborative Flavor Wheel, that's been superseded):

1. Surprise note (italic pull-quote) + three-voice story (full text) + collapsible AI tasting note — **relabel this "Liam's intake" (or similar) in the UI** (Decision #8), rather than a generic "AI tasting note." Liam is already the site's named AI sommelier (see `backend/src/features/ai_agent_liam/`); tying the AI-generated note to that persona is more consistent than an unbranded "AI" label. The underlying field (`ai_summary`) and endpoint don't need to change, only the customer-facing label. Treat the exact copy as a first draft — "Liam's intake" is Dana's working name, Camila may refine it.
2. **"Explore the full flavor breakdown →" link, placed directly next to Liam's intake/the three-voice story** — links to `/coffees` (the existing, still-live flavor-intelligence page), inviting the customer to go deeper if they want it, rather than trying to fit that depth inside a shopping card. This is the actual resolution to the flavor-intelligence-prominence concern raised earlier in this project (see Decision #9).
3. Dimension bars (via `/:coffeeId/dimensions`) and the Collaborative Flavor Wheel / bubble cloud (via `/:coffeeId/flavor-wheel`) — kept in Bloom at their normal existing size and position (after the notes, not before), same as `CoffeesPage.tsx` today. Not removed from Bloom, just not elevated.
4. Compatibility badge + dimension comparison text for logged-in users with an archetype (same logic as today)
5. **Bloom Dial hop navigation** — up to 3 links from `GET /api/coffees/:coffeeId/hops`, rendered as a small row at the bottom of the revealed card (below the informational content, above or beside the commerce controls), e.g. "← Lighter — Bright & Bold · more acidity →". Style these as an action row — outlined pills or underlined text, not full buttons — so they read as navigation, not as competing with "Add to cart". Clicking one:
   - **Same archetype** (`hopType: "within_archetype"`): scroll to that position card within the current section and auto-reveal it, using the same reveal mechanic as a manual click.
   - **Bridge hop** (`hopType: "bridge_archetype"`): scroll to the target archetype's section elsewhere on the page and auto-reveal the target card there. Include the target archetype name in the link copy since it jumps further, e.g. "→ Balanced & Sweet · ◉ Classic — Classic Balanced · smoother, less bitterness".
   - Link copy is built entirely from `positionLabel` + `platformName` + `dimensionName`/`direction` — never a coffee name or roaster. Treat the exact phrasing as a first draft — don't block the build on wordsmithing this, the underlying data/behavior is what matters here.

**Top-of-page archetype index, not a literal coffee sidebar.** Since the page is now organized as scrolling full-bleed sections (Camila's model) rather than a sidebar+detail app (Coffees' model), replace the old flat coffee-list sidebar with a slim jump-nav: one entry per archetype (color-coded, matching the section it scrolls to), sticky or inline near the top of the page. There's no longer a flat list of raw coffees to organize, because the archetype sections plus their position cards already are the organization.

**Compare mode becomes a focused overlay, not an inline page state.** Because the page is a long editorial scroll rather than a single-coffee detail view, don't try to reflow the whole page into a side-by-side layout the way `CoffeesPage.tsx` does today. Instead: a "⇄ Compare" action on a revealed card opens an overlay/modal where the user picks a second slot (any archetype), and the modal renders the existing side-by-side treatment (stacked dimension bars, side-by-side bubble clouds, editorial content hidden to stay scannable) — same visual rules as today, just staged as a modal instead of a page state, so it doesn't disrupt Camila's scroll layout underneath it.

**Cart is persistent across the scroll.** A small floating cart affordance (icon + item count, minimal chrome consistent with the rest of the site) stays visible while the user scrolls through multiple archetype sections adding items, rather than requiring a page navigation per add. Opening it shows the line items and the checkout action.

**Don't fork the informational-layer logic between the two live pages.** `CoffeesPage.tsx` and `BloomPage.tsx` will both be live at the same time, both rendering dimension bars, bubble clouds, the collapsible AI note, and the compatibility-badge/adjacency logic. Extract these into shared components/hooks (e.g. `DimensionBars`, `CollaborativeFlavorWheel`, `useCompatibility`) that both pages import, rather than copy-pasting the JSX/logic into `BloomPage.tsx`. Otherwise a future fix to one will silently not apply to the other. **Side effect worth knowing about, not avoiding:** if the "Liam's intake" and "Collaborative Flavor Wheel" labels live in the shared component, they'll also change on the still-live `/coffees` page, not just on `/bloom`. That's fine — consistent naming across both pages is better than a fork — just don't be surprised when `CoffeesPage.tsx`'s copy changes as a side effect of building `BloomPage.tsx`.

### Commerce + informational layer summary (per position card)

- **Identity** — position label + platform name. Never a roaster or raw coffee name, anywhere, including inside the compare overlay.
- **Informational layer**, in display order (unchanged from `CoffeesPage.tsx` today) — surprise note + three-voice story + "Liam's intake" + explore-further link to `/coffees`, then dimension bars + Collaborative Flavor Wheel, then compatibility badge, compare, Bloom Dial hop navigation. All content is tied to the same stock-resolved `coffeeId` from Part 1 — never a mix of one coffee's notes with another's dimensions.
- **Commerce layer** — per-weight price + weight selector (availability-filtered, each option showing its own price), add to cart.

**Cart state** (React context or component state — no `localStorage`/`sessionStorage`, use in-memory state consistent with the rest of this app): each line item is `{ archetype, dialSortOrder, weightOz, platformName, retailPriceCents, qty }`, where `retailPriceCents` is the price for that specific `weightOz` (matched by weight, at the moment it was added to the cart — don't re-look-up price at checkout time, use what was shown when the customer clicked "Add to cart"). No `coffeeId`, no roaster, ever, anywhere in cart state.

**Checkout**: `POST /api/orders`, already `requireAuth`-gated — reuse that, don't add a second auth path. Send slot-based items (`{ archetype, dialSortOrder, weightOz }` per the existing `orders.ts` contract) plus quantity. Gate the checkout button behind sign-in the same way other authenticated flows in this app already prompt sign-in (check `SignIn.tsx`/`AuthContext.tsx` for the existing pattern rather than inventing a new one).

**Order confirmation**: render from the cart's own `platformName`/`retailPriceCents`, **never** from the API response's `resolvedCoffeeName`/`resolvedRoaster` fields — those exist for internal fulfillment only (see Part 1, Phase 1d).

**Link from The Axis (approved, Decision #4)**: `TheAxis.tsx`'s Section 5 CTA currently points only to the flavor quiz ("→ Take the Flavor Quiz"). Add a secondary, visually lighter link/line beneath it to `/bloom` — e.g. "Already know your archetype? Browse The Bloom →". Keep the primary CTA (quiz) visually dominant; the Bloom link is secondary since the quiz is still the main conversion path for new visitors. Style it as a small supporting line, consistent with how other secondary CTAs are treated elsewhere on the site (e.g. the "or sign in →" line under the TasteFinderSection CTA).

---

## Phase 3 — Routing and nav

- Add `/bloom` → `BloomPage` in `App.tsx`, alongside the untouched `/coffees` and `/shop` routes.
- Add "The Bloom" to the main public nav (`Navigation.tsx`), next to the existing "The Axis" link, without removing "Our coffees" or "Shop". All four links are live simultaneously until Dana/Camila decide to cut the old two over.

---

## Testing task

1. **Manual QA pass, one full read-through of the page**: every archetype section renders with the correct hero photo/bag art/color; every position card shows the correct state — active (identity, teaser, price per weight, working weight selector, add to cart, reveal) vs. temporarily unavailable (greyed out, no controls). If real data has at least one inactive/out-of-stock position, verify that specific card renders correctly rather than only testing the happy path.
2. **Reveal/collapse**: opening a card shows the full informational layer in the specified order (notes/Liam's intake + explore link, then dimension bars + Collaborative Flavor Wheel, then compatibility badge, then hop links); collapsing hides it again without layout breakage.
3. **Hop navigation**: click a within-archetype hop and confirm it scrolls to and auto-reveals the correct card in the same section; click a bridge-archetype hop and confirm it scrolls to the correct *other* section and reveals the correct card there. Confirm hop link text never shows a coffee name or roaster.
4. **Compare overlay**: opens as a modal without disrupting the underlying scroll position; renders the side-by-side treatment correctly; closes cleanly.
5. **Cart + checkout, full journey**: add items from at least two different archetype sections without losing earlier items, open the persistent cart, proceed to checkout while signed out (confirm sign-in gate triggers), sign in, complete checkout. Since Shopify credentials aren't live, expect the flow to fail at the actual `createOrder()` Shopify call (per `WHAT_WE_BUILT.md` #77) — confirm everything *up to* that point works, and that the failure is graceful (a clear message), not a silent crash.
6. **No leaks, anywhere in the UI**: inspect the rendered page and network responses across every state above (cards, revealed content, cart, checkout, order confirmation, hop links) and confirm `roaster` and raw internal coffee names never appear — this is the single most important thing to verify given the drop-ship requirement.
7. **Explore-further link**: clicking "Explore the full flavor breakdown →" correctly navigates to `/coffees` and (if implemented) auto-selects/expands the right coffee there.
8. **Regression check on `/coffees`**: since dimension bars/Collaborative Flavor Wheel/compatibility logic get extracted into shared components, open `/coffees` directly and confirm it still renders and behaves exactly as before — including the new "Liam's intake"/"Collaborative Flavor Wheel" labels, which will now also appear there as an intentional side effect (see the "don't fork" note above) — that's expected, not a bug.
9. **Regression check on `/shop` and `/the-axis`**: confirm both are completely unaffected, except for the new secondary link added to `TheAxis.tsx`'s CTA section.
10. **Mobile/slow-connection pass**: given the image-loading changes in Phase 2, check the page on a throttled/mobile viewport specifically — confirm below-the-fold images aren't fetched until scrolled near, and that layout doesn't jump as they load in.
11. **Nav check**: confirm "The Bloom" appears in `Navigation.tsx` alongside the three existing links, none removed.

---

## Decisions Dana has confirmed (do not re-litigate these — full list, shared with Part 1)

1. **Pricing** — price is per slot **per weight**, on a new `dial_slot_price` table. Defaults where unset: **$38.00 for 12oz**, **$199.00 for 5lb** (Claude's recommendation, adjustable).
2. **`GET /api/coffees` roaster leak on the still-live `/coffees` page** — leave it untouched, not in scope. `/coffees` won't be retired (see #9).
3. **Empty slots** — "Temporarily unavailable" state, not hidden.
4. **Axis → Bloom cross-link** — approved, implemented in this part.
5. **Bloom Dial hop navigation** — approved, in scope.
6. **Notes must match the coffee that actually ships** — resolved via `resolveBlendForSlot` in Part 1, consumed as-is here.
7. **Collaborative Flavor Wheel prominence — superseded, see #9.** Bloom's card keeps the Wheel exactly where and how `CoffeesPage.tsx` shows it today — no reorder, no resize.
8. **"Liam's intake" naming** — confirmed. The AI-generated tasting note is labeled "Liam's intake" instead of a generic "AI tasting note."
9. **A dedicated "flavor intelligence" page is a future project, not part of this build.** `/coffees` should eventually evolve into a richer, secondary destination (more stats, SCA descriptor detail). This build's only obligation is the explore-further link. A context note for Liam-side work is in `backend/src/features/ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` — not implemented here.

---

## Out of scope for this build (full list, shared with Part 1)

- Any changes to `TheAxis.tsx` beyond the one secondary link.
- Retiring `/coffees` or `/shop`.
- Wiring real Shopify credentials.
- Any admin-side changes to how hops are created, suggested, or validated.
- Building the enhanced "flavor intelligence" version of `/coffees` — Decision #9.
- Any Liam (AI sommelier) changes — noted for later, not implemented here.
- The deferred image/photo performance work (recompression, responsive sizes) — see `IMAGE_PERFORMANCE_FINDINGS.md`.

---

## Summary checklist (Part 2)

- [ ] `BloomPage.tsx` — Camila's archetype shell preserved, hardcoded `ARCHETYPES` replaced with live data from Part 1's endpoint
- [ ] Images: same files as `Shop.tsx`, unmodified — `loading="lazy"` below the fold, explicit dimensions/`aspect-ratio`, `alt` text
- [ ] Position cards: active state (identity, teaser, price, weight, cart, reveal) and "Temporarily unavailable" state
- [ ] Revealed-card informational layer, unchanged order from `CoffeesPage.tsx`: notes/"Liam's intake" (+ explore-further link) → dimension bars/Collaborative Flavor Wheel → compatibility badge → hop links
- [ ] Shared `DimensionBars`/`CollaborativeFlavorWheel`/compatibility logic extracted for use by both `CoffeesPage.tsx` and `BloomPage.tsx`
- [ ] Archetype jump-nav (replaces the flat coffee sidebar)
- [ ] Compare mode as overlay/modal, not inline page state
- [ ] Persistent floating cart + checkout via `POST /api/orders`
- [ ] Secondary "Browse The Bloom" link added to `TheAxis.tsx`'s CTA section
- [ ] `/bloom` route in `App.tsx`; "The Bloom" nav link added alongside existing links, nothing removed
- [ ] Testing task above completed, including the no-leaks pass and both regression checks
