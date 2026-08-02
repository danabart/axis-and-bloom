# CLAUDE CODE PROMPT — The Bloom Part 12: Restore pre-brief-33 features onto Camila's Bloom Dial

## Why this exists

Camila shipped the Bloom Dial production build (brief 33) as commit `ac424ef`
("feat(bloom): Bloom Dial production build (brief 33) — Bloom page only",
authored Jul 31) directly to `main`, which auto-deployed. It added a beautiful
new reusable dial at `frontend/src/app/components/bloom/dial/` (BloomDial.tsx,
fillEngine.ts, linework.ts, archetypeConfig.ts) and rewired **only**
`BloomPage.tsx` to mount it instead of `ArchetypeSection`.

Nothing was deleted — `ArchetypeSection.tsx`, `PositionCard.tsx`,
`RevealedPanel.tsx`, `CompareOverlay.tsx`, and `usePositionCardData.ts` all
still exist and still power Find My Flavor and Profile. But on `/bloom` these
features vanished:

- "Reveal the full profile" toggle and the entire revealed layer: Liam's
  intake / tasting notes, "Explore the full flavor breakdown" and "Talk to
  Liam" links, dimension bars, Collaborative Flavor Wheel, "In your
  wheelhouse" compatibility badge
- Worth-exploring hop chips
- "Save to my flavor memory" (explicit save + its Dial Event Log trigger)
- 12oz/5lb weight picker, Add to cart, Compare, "Price includes shipping"
  (replaced by one PRE-ORDER button hardcoded to 12oz)
- Real slot states: her dial always shows 4 coffees, filling empty slots with
  placeholder names (e.g. "Golden Hour") that are **purchasable at hardcoded
  $32/$185 defaults** — the old "Unpriced" / "Temporarily unavailable"
  blocking is gone

Her commit message itself says it was never built or tested ("no node runtime
in this environment... Needs local/CI build + Safari pass before merge").

## Approved decisions (Dana, 2026-08-01)

1. **Keep Camila's design.** The brief-33 dial becomes THE archetype
   component, everywhere the archetype div renders.
2. **Restore full commerce**: 12oz/5lb weight picker, Add to cart, Compare,
   "Price includes shipping" — restyled to live in the dial's reading column.
3. **Restore the informational layer** as an expandable "Reveal the full
   profile ↓" link in the reading column that opens the existing full-width
   `RevealedPanel` below the colored dial field. Same content as before.
4. **Restore "Save to my flavor memory"** with its `explicit_save` Dial Event
   Log trigger; `add_to_cart` trigger stays on add-to-cart.
5. **Apply to all four dial surfaces** — /bloom, Find My Flavor
   returning-user, Find My Flavor results, Profile (both mounts) — via a
   compact **embedded** variant for the in-page contexts.
6. **Placeholder slots are browsable, not purchasable**: keep Camila's call
   that the wheel always shows four coffees, but a position with no resolved
   catalogue slot shows "Coming soon" and no cart button. Unpriced /
   temporarily-unavailable real slots keep their old blocked states.
   Purchases must use real slot prices again, never the hardcoded defaults.
7. **Photos stay out** (consistent with her design and the Part 11
   remove-photos-and-bag direction). The bag remains inside the colored field.

## Before you start — repo state warnings

- **Pull first.** The local checkout is at `1a5381f`, one commit behind
  `origin/main` (`ac424ef` = Camila's commit, remote-only). Work on top of
  `origin/main`.
- The working tree shows ~124 "modified" files that are **CRLF line-ending
  noise only** (`git diff -w` is empty). Do not commit them; stage only the
  files you actually touch.
- `git stash list` has three entries, two marked "not mine". Leave them.
- **Do not push `main` directly** — push to `main` auto-deploys via GitHub
  Actions. Ship a branch (suggested: `fix/bloom-dial-restore-features`) and
  open a PR.

## Task 1 — Extend `bloom/dial/BloomDial.tsx` (dial engine untouched)

Add three optional props; change nothing about the fill engine, drag,
keyboard, or deep-link `rotateTo` behavior:

```ts
/** Replaces the built-in PRE-ORDER button when provided — the parent section
 *  owns commerce so all four dial surfaces share one flow. */
bottomContent?: ReactNode;
/** Full-width content rendered below the reading/instrument stage, inside the
 *  section (the revealed informational layer). */
belowStage?: ReactNode;
/** Compact variant for embedded contexts (quiz screens, Profile). */
embedded?: boolean;
```

- In the reading column: `{bottomContent ?? <existing PRE-ORDER button>}`.
- Render `{belowStage}` after `.bd-stage`, inside the `<section>`.
- `embedded` adds class `bd-embedded` to the root section. Append CSS to the
  injected stylesheet, roughly:

```css
.bd-section.bd-embedded .bd-stage{min-height:0;grid-template-columns:minmax(260px,32%) 1fr;}
.bd-embedded .bd-reading{padding:34px 30px 38px;}
.bd-embedded .bd-instrument{padding:42px 24px;}
.bd-embedded .bd-dial-wrap{width:300px;height:300px;}
.bd-embedded .bd-ruler{width:280px;margin-top:28px;}
.bd-embedded .bd-bdial{font-size:19px;margin-top:8px;}
.bd-embedded .bd-coffee-name{font-size:23px;min-height:0;margin-top:10px;}
.bd-embedded .bd-reading-bottom{padding-top:22px;}
.bd-embedded .bd-field-bag{right:22px;bottom:18px;}
.bd-embedded .bd-field-bag img{width:92px;}
@media (max-width:940px){
  .bd-embedded .bd-instrument{padding:36px 16px 96px;}
  .bd-embedded .bd-dial-wrap{width:260px;height:260px;}
}
```

(`fitLines` already scales the title stack to column width, so the embedded
title sizes itself; no change needed there.)

## Task 2 — New `bloom/DialArchetypeSection.tsx` (the unified section)

A wrapper whose **prop surface matches the old `ArchetypeSection` exactly**
(`data, index, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal,
onAddToCart, onHopClick, onCompare, userArchetype, registerDialRef, source,
hideProfileLink`) plus `embedded?: boolean`, so every call site swaps with a
one-line change. `index` is accepted for compatibility but unused (no more
flip/eager layout). Internals:

- `config = buildDialConfig(data)`; render `<BloomDial>` with
  `ref → registerDialRef(data.archetype, handle)`,
  `initialDialSortOrder={selectedSortOrder}`,
  `onZoneChange → onDialSelect(data.archetype, n)`, plus the
  `bottomContent` / `belowStage` / `embedded` props below.
- **Synthetic slot for placeholders** (hooks must run unconditionally): if
  `data.slots` has no entry for the selected position, build an inactive
  stand-in `{ dialSortOrder, positionLabel:'', description:null,
  isActive:false, platformName:null, isDefault:false, prices:[],
  coffeeId:null }` and set `isPlaceholder = true`.
- Reuse `usePositionCardData(currentSlot, data.archetype, isRevealed)` — one
  shared fetch for teaser, weight availability, and the revealed layer,
  exactly like the old PositionCard/RevealedPanel pair.
- `bottomContent` (reading column, under the live price line), styled to the
  dial's design language (small uppercase letterspaced text, terracotta
  `#9a2918` on beige, pink `#ee5974` accent):
  - teaser sentence (when purchasable)
  - if `isPlaceholder`: a bordered "COMING SOON" badge, nothing purchasable
  - else if not `effectivelyActive`: "UNPRICED" / "TEMPORARILY UNAVAILABLE"
    badge (from `isUnpriced`), nothing purchasable
  - else: weight pills (`availableWeights`, selected pill filled `#9a2918`),
    an `ADD TO CART →` button reusing the `.bd-btn` style, `⇄ COMPARE`
    text-link → `onCompare(archetype, label, currentSlot)`, and
    "Price includes shipping"
  - "REVEAL THE FULL PROFILE ↓ / COLLAPSE ↑" link → `onToggleReveal(slotKey)`
    — only when `currentSlot.coffeeId != null && currentSlot.isActive`
  - "SAVE TO MY FLAVOR MEMORY / SAVED ✓" — signed-in + real slot only;
    `setDialPosition(archetype, sortOrder, { trigger:'explicit_save', source })`,
    saved-state resets when the slot key changes
- Add-to-cart handler: build the `CartItem` from `selectedPrice` +
  `currentSlot.platformName` (never placeholder names/prices), call
  `onAddToCart`, and when signed in fire
  `setDialPosition(..., { trigger:'add_to_cart', source, coffeeId })`.
- `belowStage`: the existing `<RevealedPanel>` (key = slot key) wrapped in a
  div with horizontal padding `clamp(32px, 6vw, 96px)` on /bloom (`0` when
  embedded), passing `content/dimensions/wheelRows/hops` from the hook plus
  `userArchetype`, `onHopClick`, `hideProfileLink`.

## Task 3 — Rewire `BloomPage.tsx`

Keep: hero, sticky jump-nav, catalogue/experimental/other-categories fetches,
personalized archetype order, saved-position preload, deep-link effect, silent
auto-save in `handleDialSelect`, Other Categories section.

- Replace the raw `BloomDial` map with `DialArchetypeSection` (source
  `"bloom"`), passing the restored state.
- Restore `revealedKeys` + `toggleReveal`, `compareState` + `openCompare`,
  and `CompareOverlay` at the bottom (props identical to the pre-33 version,
  `archetypes` list).
- Restore `handleHopClick(archetype, dialSortOrder)`: `rotateTo`, **also
  `setSelectedSortOrder` for that archetype** (the new dial's `rotateTo` does
  NOT emit `onZoneChange`, unlike the old widget flow — without this the
  reading column won't switch to the hopped slot), add the slot key to
  `revealedKeys`, then `scrollIntoView` on `document.getElementById(archetype)`
  (the dial section's id is the archetype, so this still works).
- Delete her `handlePreOrder` and the now-unused `buildDialConfig` /
  `DialCoffee` / `CartItem` imports from this file.

## Task 4 — Swap the embedded surfaces

Four call sites, mechanical one-line swaps to `DialArchetypeSection` with
`embedded` added (all other props unchanged — the prop surfaces match):

- `FlavorQuiz.tsx` returning-user screen (source `"find_my_flavor_returning"`)
- `FlavorQuiz.tsx` results screen (source `"find_my_flavor_results"`)
- `Profile.tsx` matched archetype (source `"profile"`, `hideProfileLink`)
- `Profile.tsx` adjacent/worth-exploring archetype (same)

Import `computeDefaultSortOrder` still from `./bloom/ArchetypeSection`. Their
existing `BloomDialHandle` type imports from `../BloomDialWidget` are
structurally identical to the new dial's handle — no changes needed. Their
CompareOverlay/WorthExploring wiring is untouched.

Leave `ArchetypeSection.tsx` / `PositionCard.tsx` in place (no longer mounted
anywhere, but don't delete in this pass).

## Verification (required — brief 33 shipped unverified)

1. `cd frontend && npm run build` must pass. Note: there is no tsconfig and
   vite build does not type-check; be careful with prop types by hand.
2. Manual pass on `npm run dev`, all four surfaces:
   - dial drag/ruler/keyboard still work; deep link
     `/bloom?archetype=fruity&slot=2` still rotates + scrolls
   - reveal opens the full panel (intake, bars, wheel, wheelhouse badge,
     hops); hop chip rotates the target dial, reveals it, scrolls to it
   - weight pills reflect real slot availability; add-to-cart lines carry the
     real price/weight; Compare opens; placeholder positions show COMING SOON
     with no cart button; unpriced/unavailable states render
   - save-to-memory shows for signed-in users, flips to "Saved ✓", logs an
     `explicit_save` dial event with the right `source`
   - embedded variant fits the quiz results, returning-user, and Profile
     layouts on desktop + mobile widths
3. Safari pass (brief 33's own guards were never Safari-tested).
4. Branch + PR; do not push `main`.
