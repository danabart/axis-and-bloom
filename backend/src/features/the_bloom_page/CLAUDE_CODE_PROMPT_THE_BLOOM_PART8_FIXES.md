# The Bloom — Part 8: bag size, CTA clarity, deep-linked flavor intelligence, shipping note

> **Superseded note (2026-07-12) — Phase C below only.** The `exploreLink="/coffees?coffee={coffeeId}"` contract this phase built is being replaced by `backend/src/features/Flavor Intelligence Page/` (Part 1 Decision #4/#5, Part 2 Decision #8): the target route becomes `/flavor-intelligence`, and the param shape becomes `?archetype=&slot=` instead of a raw `coffeeId`. If you're implementing or re-verifying Phase C after that build has shipped, use the new contract, not what's written below — this file is kept for historical context on *why* the link is parameterized at all, not as the current source of truth for its exact shape. Phases A, B, D are unaffected.

**Prerequisite: Parts 1–4 and 7 are deployed.** Four fixes from Dana's latest screenshot review. Part 5 stays on hold.

## Phase A — Bag is now too small

Part 7 repositioned the bag between the dial and card but under-sized it in the process — in the latest screenshot it's barely visible, noticeably smaller than everything around it. **Size the bag to be visually comparable to the dial** — roughly the same footprint/prominence as the `BloomDialWidget` wheel (per Part 4, the wheel is `clamp(130px, 14vw, 190px)`), not a small accent. Keep `objectFit: 'contain'` so the artwork isn't distorted; increase both the container size and the image's own max dimensions until it reads as an equally-weighted element next to the dial, not an afterthought.

---

## Phase B — Make both CTAs unmistakable

Two separate CTAs exist today and neither is landing clearly:

1. **The in-panel text links** in `TastingNotes.tsx` ("Explore the full flavor breakdown →" and "Talk to Liam about this coffee →", rendered via `RevealedPanel.tsx` passing `exploreLink="/coffees"` and `talkToLiamLink="/sommelier"`) — the code and props are correct, but confirm these are actually visible and not just present in the DOM below the fold or too visually quiet against the surrounding text to register. Give them more visual separation from the AI summary paragraph above (more top margin/padding, maybe a thin top border to set them apart as an actions row rather than more paragraph text), and consider a small leading icon per link (a chat-bubble glyph for Talk to Liam, an arrow/compass glyph for the flavor breakdown) so they read as actions at a glance, not just more prose to skim past.
2. **The floating "Talk to Liam" button** (`FloatingCart.tsx`, added in Part 4 next to the cart icon) is icon-only with just an `aria-label` — fine for accessibility, not sufficient for a first-time visitor to understand what it does at a glance. Add a visible label on hover/focus (a small tooltip, or a text pill that expands on hover the way some floating action buttons do) rather than leaving it a bare, unlabeled circle next to the cart.

Verify both fixes by actually looking at the rendered page afterward, not just the diff — this is a visual-clarity problem, confirm it reads clearly to someone seeing it fresh.

---

## Phase C — Deep-link the flavor intelligence CTA to the actual coffee

**Root cause, confirmed in code:** `exploreLink="/coffees"` is a hardcoded, unparameterized string in `RevealedPanel.tsx` — it always sends the customer to `/coffees`'s default state, which is whatever `CoffeesPage.tsx`'s `selectedId` initializes to (currently always `null` — no coffee pre-selected, `useState<number | null>(null)`). That's why clicking it from a Fruity card shows an unrelated default view instead of that specific coffee.

Fix, in two halves:

- **`RevealedPanel.tsx` / wherever `exploreLink` is constructed**: build it as `` `/coffees?coffee=${coffeeId}` `` using the slot's already-available internal `coffeeId` (the same one already used to fetch `/dimensions`, `/flavor-wheel`, `/hops` — never rendered anywhere, this is simply a new use of a value already in scope, not a new leak).
- **`CoffeesPage.tsx`**: read a `coffee` query param on mount (`useSearchParams`, same pattern already used in `FlavorQuiz.tsx` for its `result=` preview param) and use it to initialize `selectedId` instead of always starting at `null` — if the param is present and matches a real coffee, select it (and scroll/expand to it in the sidebar if the sidebar doesn't already default to showing the selected coffee); if absent or invalid, fall back to today's existing default behavior unchanged.

---

## Phase D — "Price includes shipping" note

Small text beneath the price/weight row in `PositionCard.tsx` (the row with the 12oz/5lb buttons and "Add to cart") — something like *"Price includes shipping"*, styled as a quiet secondary line (small, muted color, consistent with other fine-print treatment already on the site), not competing visually with the price or the Add to cart button. Exact wording is a first draft, adjustable — the point is the fact ("shipping's included, no surprise at checkout"), not precise phrasing.

---

## Testing task

1. **Bag size**: confirm it now reads as comparably prominent to the dial, across a couple of different archetypes (bag artwork proportions may vary).
2. **CTA clarity**: with fresh eyes (or ask someone unfamiliar with the page), confirm both "Explore the full flavor breakdown" / "Talk to Liam about this coffee" text links and the floating Talk-to-Liam button are immediately understandable, not just technically present.
3. **Deep link**: from a revealed Fruity card, click "Explore the full flavor breakdown" and confirm `/coffees` opens with that *same* coffee selected, not a default/unrelated one. Repeat for at least one other archetype to confirm the parameter isn't hardcoded to one case.
4. **Fallback**: visit `/coffees` directly with no `coffee` param (the normal nav-link path) and confirm it still behaves exactly as it did before this change.
5. **Shipping note**: confirm it appears under the price row, doesn't crowd the existing buttons, and reads clearly at the site's normal font sizes.

---

## Out of scope for this part

- Part 5 (Find My Flavor reuse) — still on hold.
- Any redesign of `CoffeesPage.tsx`'s sidebar beyond honoring the new `coffee` query param.

## Summary checklist

- [ ] Bag resized to match the dial's visual prominence
- [ ] In-panel explore/Talk-to-Liam links given clearer visual separation and (optionally) leading icons
- [ ] Floating Talk-to-Liam button gets a visible hover/focus label, not icon-only
- [ ] `exploreLink` built with `?coffee={coffeeId}`; `CoffeesPage.tsx` reads the param and pre-selects that coffee, falling back to current default behavior when absent
- [ ] "Price includes shipping" note added beneath the price row
- [ ] Testing task completed, including the deep-link check across more than one archetype
