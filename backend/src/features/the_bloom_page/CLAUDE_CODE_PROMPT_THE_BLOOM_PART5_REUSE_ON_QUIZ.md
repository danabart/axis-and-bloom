# The Bloom — Part 5 of 5: reuse the archetype section on Find My Flavor

> **Superseded note (2026-07-12) — Phase D only.** Because `ArchetypeSection` is shared, fixing `RevealedPanel.tsx`'s `exploreLink` for `backend/src/features/Flavor Intelligence Page/` (new `/flavor-intelligence` route, `?archetype=&slot=` params) automatically fixes it on both Find My Flavor screens described here too, not just `/bloom` — see that folder's Part 2 Decision #8, which calls this out explicitly. No extra work needed on this file's account, but worth testing both Find My Flavor screens (not just Bloom) when that build ships. Phases A–C are unaffected.

**Prerequisite: Parts 1–4 are deployed.** This extends The Bloom's shop-and-explore unit onto `FlavorQuiz.tsx` (`/find-my-flavor`) instead of rebuilding it there. **This explicitly reverses earlier guidance** — Parts 3 and 4 both said "don't touch `FlavorQuiz.tsx`, `BloomDial` stays exactly as is." That's no longer true for this part; confirmed with Dana, read carefully before assuming the old restriction still applies.

## What's being reused, and why this is worth doing as reuse rather than rebuilding

`BloomPage.tsx` already has a self-contained cluster — photo, dial, dynamic position card, reveal panel — for a single archetype. `FlavorQuiz.tsx` has two separate moments where a user's archetype is shown and currently does nothing shopping-related with it. Building the same explore/personalize/buy experience twice would mean every future fix (like Part 4's reveal-panel width fix) needs to be made twice and will drift. Extract once, use twice.

---

## Phase A — Extract `ArchetypeSection` into a shared, reusable component

In `BloomPage.tsx`, the per-archetype block (archetype header, three-column row of photo/dial/card, per Part 4 now also the full-width revealed panel beneath it) is currently a component or inline render local to that file. Move it to `frontend/src/app/components/bloom/ArchetypeSection.tsx`, keeping its existing props (`data`, `visual`, `flip`, `eager`, `selectedSortOrder`, `revealedKeys`, `onDialSelect`, `onToggleReveal`, `onAddToCart`, `onHopClick`, `onCompare`, per the shape already used in `BloomPage.tsx`), plus one new prop:

- **`showPhoto?: boolean` (default `true`)** — when `false`, omit the photo column entirely. Redistribute the row's flex proportions when hidden (e.g. dial column grows from `26%` to roughly `38%`, card column takes the rest) rather than leaving a blank gap. `BloomPage.tsx` itself always passes `showPhoto={true}` (or omits the prop) — no visual change there.

`BloomPage.tsx` imports and loops this component exactly as it does today; this phase is a pure extraction, no behavior change on `/bloom` itself.

---

## Phase B — Lift the cart from page-local to app-wide, confirmed with Dana

Today the cart (`FloatingCart.tsx` + whatever state holds `CartItem[]`) is local to `BloomPage.tsx`. For Find My Flavor to add to the same cart, it needs to live above both pages.

- Create `frontend/src/app/context/CartContext.tsx` — same in-memory state shape already established in Part 2 (`{ archetype, dialSortOrder, weightOz, platformName, retailPriceCents, qty }[]`, no `localStorage`/`sessionStorage`), exposing add/remove/checkout state via context, mirroring whatever `BloomPage.tsx` currently does internally — this is a relocation of existing logic, not new cart logic.
- Wrap it around both `/bloom` and `/find-my-flavor` at minimum — simplest correct option is wrapping the whole `<PublicLayout>`/router tree in `App.tsx` with the new `CartProvider`, so it's available everywhere without route-by-route wiring, and `FloatingCart` can be rendered once at a layout level instead of per-page.
- `BloomPage.tsx` and `FlavorQuiz.tsx` both consume `useCart()` (or equivalent) instead of `BloomPage.tsx` owning cart state directly.
- **`FloatingCart` becomes a layout-level persistent element** (rendered once, e.g. in `PublicLayout.tsx`) rather than something each page renders separately — it should now appear on `/find-my-flavor` too, not just `/bloom`, since the cart is shared and a user should be able to see/manage it from wherever they added something.

---

## Phase C — Embed `ArchetypeSection` on both Find My Flavor screens

Both screens get `<ArchetypeSection showPhoto={false} .../>` for the user's single matched archetype (not the full archetype loop Bloom shows) — fetch that one archetype's data from the existing `GET /api/coffees/archetypes` (Part 1) and pass just the matching entry, same shape `BloomPage.tsx` already uses per-archetype.

### C1 — Returning-user screen (State 1, right panel)

Matches Dana's "profile is: Earthy" phrasing. Below the existing "Your primary profile is [Archetype]" / description / "Last quiz taken" block, render the embedded `ArchetypeSection` for that archetype. This is the lower-risk half of this part — it's an addition to a static screen, not a change to an animated/stateful one.

### C2 — Just-finished-quiz curtain/reveal screen

This is the bigger lift, and the reason the earlier "don't touch" guidance is being reversed. Today this screen has its own one-off, hardcoded `BloomDial` (Chocolate & Nutty only, mock `BODY_LEVELS`, fictional coffees) in the left column, with a "Coffee reveal panel" on the right that fades in after the user drags the dial and clicks "SEE YOUR PERSONALIZED COFFEE."

**Replace that entire hardcoded mechanic with the real, generalized `ArchetypeSection` (`showPhoto={false}`), for whichever archetype the user actually matched — every archetype, not just Chocolate & Nutty.** Concretely:

- Remove (or leave dead/unused, Claude Code's judgment on which is cleaner) the local `BloomDial` function, `BODY_LEVELS` array, and the `archetypeKey === 'chocolate' ? <BloomDial /> : <placeholder>` branching in `FlavorQuiz.tsx` — this was the mock version being replaced.
- The bag image already shown in this screen's right column stays — `showPhoto={false}` avoids showing it a second time via `ArchetypeSection`.
- The existing curtain/scroll-reveal mechanic (the `200vh` container, sticky viewport, curtain wallpaper sliding up) stays untouched — only what appears *after* the curtain clears changes, not the reveal-in mechanic itself.
- This screen now works identically for all archetypes instead of only Chocolate & Nutty — a real improvement, but also real surface area. **Test this screen particularly carefully** (see Testing task) since it previously only had to work for one archetype and now needs to work for all of them, with animation timing that wasn't previously exercised for the others.

---

## Phase D — The explore-flavor-intelligence link is already included, no new work

`ArchetypeSection` renders `PositionCard`, which renders `TastingNotes` with its `exploreLink="/coffees"` prop already wired (Part 2/3). Reusing the component on Find My Flavor means this link is already present on both new screens automatically. **Nothing to build here** — just confirm it during testing rather than assuming.

---

## Phase E — "Give feedback" prompt, reusing `OrderFeedbackForm`

**Confirmed with Dana: reuse the existing order-scoped feedback form, don't build the more ambitious not-yet-built general SCA-wheel feedback flow.** `OrderFeedbackForm.tsx` + `POST /api/orders/:orderId/feedback` already exist and work (`{ rating: 1-5, note? }`, ownership-checked). The gap is finding *which* order to attach it to.

- `order_line_item` doesn't store archetype directly — only `blend_id` → `roaster_blend.coffee_id` → `coffees.id` → `archetype_assignments.archetype`. New endpoint needed: **`GET /api/users/orders/recent-by-archetype?archetype=`** (`requireAuth`) — joins that chain, filtered to the signed-in user's orders, returns the most recent matching `orderId` (or `null` if none).
- On both Find My Flavor screens, alongside the embedded `ArchetypeSection`, call this endpoint. If it returns an `orderId`, show a small "How was your last [Archetype] coffee? →" prompt that opens `OrderFeedbackForm` for that order (reuse the component as-is, check how it's invoked elsewhere — likely from `Profile.tsx` or an orders list — and match that pattern rather than inventing a new invocation style). If it returns `null`, **don't show the prompt at all** — no order, nothing to ask about yet.

---

## Testing task

1. **Extraction regression**: `/bloom` itself renders identically to before this part — same photo/dial/card behavior, same reveal-panel width fix from Part 4. This should require zero visual change on `/bloom`; if anything looks different, the extraction wasn't behavior-preserving.
2. **Shared cart**: add an item on `/find-my-flavor`, navigate to `/bloom`, confirm it's still in the cart (and vice versa). Confirm the floating cart icon/count is consistent across both pages and updates live. Confirm checkout still works from `/bloom` with an item that was added on `/find-my-flavor`.
3. **Returning-user screen**: confirm the embedded section appears below the existing profile text, with no photo column, correctly redistributed dial/card widths, and full add-to-cart/reveal/hop functionality.
4. **Curtain/reveal screen — test every archetype, not just Chocolate & Nutty**: for each of the 5 real archetypes plus Experimental, confirm the curtain reveal still animates correctly, the embedded `ArchetypeSection` renders correctly for that specific archetype (not just the one that used to be hardcoded), and the bag image + archetype text in the right column still look correct alongside it.
5. **Feedback prompt**: as a test user with a past order in a given archetype, confirm the prompt appears with the correct order pre-filled; as a test user with no such order, confirm it's absent, not broken/empty.
6. **Explore-flavor-intelligence link**: confirm it's present and working on both new embed locations, same as it already is on `/bloom`.

---

## Decisions Dana has confirmed (this part)

1. Reuse `ArchetypeSection` (with a new `showPhoto` prop) rather than rebuilding a parallel version for Find My Flavor.
2. Shared, app-wide cart — one cart, works from either page.
3. Embed on **both** Find My Flavor screens, including the curtain/reveal screen — which reverses the earlier "don't touch `FlavorQuiz.tsx`" guidance from Parts 3–4. The old one-off Chocolate & Nutty-only `BloomDial` on that screen is retired in favor of the real, all-archetype version.
4. Feedback prompt reuses the existing order-scoped `OrderFeedbackForm`, shown only when a relevant past order exists — the more ambitious general feedback flow (independent of orders) stays out of scope, as already noted as a distinct future project in `WHAT_WE_BUILT.md`.

## Out of scope for this part

- Building the general, order-independent SCA-wheel feedback flow.
- Any changes to the curtain/scroll-reveal mechanic itself (the `200vh`/sticky/wallpaper animation) — only what renders after it clears changes.
- Extending this reuse to any other page beyond Find My Flavor's two screens.

## Summary checklist

- [ ] `ArchetypeSection.tsx` extracted to `frontend/src/app/components/bloom/`, with a `showPhoto` prop; `/bloom` behavior unchanged
- [ ] `CartContext` created and wrapped around at least `/bloom` and `/find-my-flavor`; `FloatingCart` promoted to a layout-level element
- [ ] Returning-user screen: embedded `ArchetypeSection` below the existing profile text
- [ ] Curtain/reveal screen: old hardcoded `BloomDial`/`BODY_LEVELS` replaced with embedded `ArchetypeSection`, working for every archetype
- [ ] `GET /api/users/orders/recent-by-archetype` — new endpoint, joins `order_line_item` → `roaster_blend` → `coffees` → `archetype_assignments`
- [ ] Feedback prompt wired on both screens, reusing `OrderFeedbackForm`, hidden when no relevant order exists
- [ ] Testing task completed, including every archetype on the curtain/reveal screen specifically
