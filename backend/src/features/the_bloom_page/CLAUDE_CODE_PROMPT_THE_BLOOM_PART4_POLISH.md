# The Bloom — Part 4 of 4: post-launch polish (Liam link, dial legibility, wide reveal panel)

**Prerequisite: Parts 1–3 are deployed.** This is a visual/UX polish pass from Dana's review of the live Part 3 build. References exact current code — read the cited files before editing, since line numbers will shift.

## Phase A — "Talk to Liam" link

`/sommelier` (component `Sommelier.tsx`) is already gated behind `RequireAuth` in `App.tsx` — link to it plainly, the existing sign-in redirect handles unauthenticated clicks, same pattern checkout already relies on.

- **Primary placement, in `PositionCard.tsx`'s revealed layer** (`frontend/src/app/components/bloom/PositionCard.tsx`, inside the `<TastingNotes .../>` area or directly beside it, ~line 175): add "Talk to Liam about this coffee →" linking to `/sommelier`, styled as a secondary text link consistent with the existing `exploreLink="/coffees"` treatment already passed into `TastingNotes` — check whether `TastingNotes` already supports a second link prop, or add one, rather than duplicating its link styling inline.
- **Secondary placement, confirmed with Dana: add it.** A second persistent floating button next to the existing cart icon in `FloatingCart.tsx`. Current cart button: `fixed`, `bottom: 28, right: 28`, 56px circle, `#9a2918` background, `z-[60]` (lines ~24–39). Add a "Talk to Liam" button with the same treatment (size, `z-[60]`, shadow), positioned just to its left — `bottom: 28, right: 96` (56px button width + 12px gap) — wrapped in `<Link to="/sommelier">` rather than a plain `<button>`, since this one navigates rather than toggling a panel. Give it a distinct icon (a chat/speech-bubble glyph, not the same shopping-bag icon) and its own `aria-label="Talk to Liam"`. Use a visually secondary treatment relative to the cart (e.g. an outlined/lighter version of the rust color rather than the same solid fill) so the cart stays the visually primary floating action and this reads as a secondary, always-available option next to it.

---

## Phase B — Dial legibility and size

In `BloomDialWidget.tsx`:

- **Wheel size**: currently `clamp(180px, 20vw, 280px)` (line ~188). Reduce to roughly `clamp(130px, 14vw, 190px)` — smaller footprint, matches Dana's "bulky" note.
- **Text contrast**: the "← Lighter / {dimensionLabel} →" row (line ~167-168) is `fontSize: '0.48rem'` at `opacity: 0.5`. Bump to roughly `fontSize: '0.58rem'`, `opacity: 0.65`. Same treatment for the position description text (line ~207, currently `opacity: 0.46`) — bump to roughly `0.68`. Leave the position label itself (line ~202, already full opacity) as is. The goal is text that's still clearly secondary/quiet in weight (this is still meant to read as understated, matching the rest of the site's design language) but no longer borderline unreadable — err toward "slightly more visible than feels necessary," it's easy to dial back down.
- **Remove the "DIMENSION: ___" line entirely** (lines ~172–176 — the `<p>DIMENSION: {dimensionLabel.toUpperCase()}</p>` block). The "← Lighter / {dimensionLabel} →" row above it already shows the alias by itself; the separate line was the only place the word "dimension" appeared, and Dana wants it gone, alias-only.

---

## Phase C — "Personalize your {archetype}" tag above the dial

`BloomDialWidget` currently has no archetype-name prop — add one:

- Add `archetypeLabel: string` to `BloomDialWidgetProps` (currently `color`, `positions`, `dimensionLabel`, `defaultSortOrder`, `initialSortOrder`, `onSelect`).
- In `BloomPage.tsx`'s `<BloomDialWidget .../>` call (~line 112–120), pass `archetypeLabel={data.archetypeLabel}` — that value already exists on `data`, it's just not currently passed to the dial.
- Render a small eyebrow/tag above the existing "← Lighter / X →" row: `PERSONALIZE YOUR {archetypeLabel.toUpperCase()}` — same visual weight/style as the site's other small uppercase eyebrow labels (see the `No. {visual.num}` / archetype-label pair already in `BloomPage.tsx` lines 74–79 for the established pattern — match that, don't invent new styling).

---

## Phase D — Fix the narrow reveal panel: break it out of the three-column layout

**This is a structural change, not a style tweak.** Today, `BloomPage.tsx`'s archetype section is one `display: flex` row with three children: photo column (`flex: 0 0 34%`), dial column (`flex: 0 0 26%`), and the position-card column (`flex: 1, minWidth: 0` — the remaining ~40%, which also holds a large archetype heading above the card). `PositionCard.tsx` renders its entire revealed informational layer (`TastingNotes`, `DimensionBars`, `CollaborativeFlavorWheel`, compatibility badge, hop links) inside that same narrow ~40% column — that's the structural cause of "long and narrow."

**Fix: split `PositionCard` into two pieces — a compact collapsed card (stays in the narrow column, unchanged) and a full-width revealed panel (renders below the entire three-column row, not inside any column of it).**

- `PositionCard.tsx` keeps the collapsed header + commerce row exactly as they are today (lines ~107–162) — that content is fine at its current width.
- Extract the revealed content (lines ~164–206, the `AnimatePresence`/`isRevealed` block) into a new sibling render, not nested inside the narrow column. Two ways to do this, pick whichever fits the existing state management more cleanly:
  - **Option 1 (simpler)**: keep `isRevealed` state where it already lives (in `BloomPage.tsx`, the `revealedKeys` set), and in `BloomPage.tsx`'s `ArchetypeSection`, render the revealed panel as a new block *after* the closing of the three-column `flex` row (not inside the `flex: 1` column), conditional on `revealedKeys.has(currentKey)`. The three-column row stays exactly as it is (photo, dial, collapsed card); the expanded content appears full-width beneath all three columns when a card is revealed.
  - **Option 2**: keep the revealed content inside `PositionCard.tsx` for encapsulation, but have it render via a portal or a full-width wrapper that escapes the parent's `flex: 1` sizing (e.g. `width: 100vw` with negative margins to counteract the section's padding) — more fragile, only use this if Option 1 turns out to be awkward given how `ArchetypeSection` is structured.
- Once full-width, give `DimensionBars` and `CollaborativeFlavorWheel` room to lay out horizontally instead of the current forced-narrow vertical stack — check whether either component already has a wider/horizontal layout mode it's not currently getting space to use, versus needing actual layout changes inside those components. Likely the former, since they were originally built for `CoffeesPage.tsx`'s wider single-column layout.
- Compare mode (`CompareOverlay.tsx`) already renders as a modal, unaffected by this — no change needed there.

---

## Testing task

1. **Liam link**: from a revealed card, click "Talk to Liam about this coffee" signed out — confirm it redirects to sign-in, then lands on `/sommelier` after auth, consistent with the checkout flow's existing behavior. Repeat signed in — confirm direct navigation. Repeat both checks for the new floating "Talk to Liam" button next to the cart icon — confirm it's visible and correctly positioned (not overlapping the cart button) while scrolling through multiple archetype sections.
2. **Dial legibility**: visually confirm the wheel is smaller, the directional/alias text is comfortably readable at normal viewing distance (not just technically higher-contrast on paper), and "DIMENSION:" no longer appears anywhere.
3. **Personalize tag**: confirm it appears above the dial on every archetype section, with the correct archetype name, styled consistently with the site's other eyebrow labels.
4. **Reveal panel width**: open a card's full profile and confirm the dimension bars, Collaborative Flavor Wheel, and notes render in a visibly wider block than before — compare against the pre-Part-4 screenshot if one exists. Confirm collapsing still works cleanly (no leftover full-width block, no layout jump). Confirm this works for archetype sections in both flip orientations (`flip`/non-`flip`), since the three-column row's `flexDirection` reverses between them.
5. **Regression**: confirm the collapsed card, commerce row, weight selector, add-to-cart, and compare button are all unaffected by the Phase D restructuring — only the revealed panel's position/width should have changed, nothing about the collapsed state.

---

## Out of scope for this part

- Any further copy/wording changes beyond removing "DIMENSION:" and adding the "Personalize your ___" tag.
- Any changes to `DimensionBars`/`CollaborativeFlavorWheel`'s internal rendering logic beyond giving them more width to work with — if they need real layout changes to take advantage of the extra space well, flag that back to Dana rather than guessing at a redesign.

## Summary checklist

- [ ] "Talk to Liam about this coffee →" link in the revealed card, linking to `/sommelier`
- [ ] Second floating "Talk to Liam" button next to the cart icon in `FloatingCart.tsx`, linking to `/sommelier`, visually secondary to the cart
- [ ] Dial wheel reduced from `clamp(180px, 20vw, 280px)` to roughly `clamp(130px, 14vw, 190px)`
- [ ] Directional/alias text opacity and size increased for legibility
- [ ] "DIMENSION: ___" line removed entirely
- [ ] `archetypeLabel` prop added to `BloomDialWidget`; "Personalize your {archetype}" tag rendered above the dial
- [ ] Revealed informational layer restructured to render full-width below the three-column row, not inside the narrow position-card column
- [ ] Testing task above completed, including both flip orientations and the regression check on collapsed-state behavior
