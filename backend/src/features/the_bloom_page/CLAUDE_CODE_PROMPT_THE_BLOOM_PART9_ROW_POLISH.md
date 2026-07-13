# The Bloom — Part 9: fix card width, design the unavailable state, stop sizing the photo relative to its neighbors

**Prerequisite: Parts 1–4, 7, and 8 are deployed.** Three related fixes from the latest screenshots (Fruity — active position; Balanced & Sweet — temporarily unavailable position). Part 5 stays on hold.

## Diagnosis

Parts 6/7 sized the photo column relative to whatever height the dial+bag+card group happened to produce. That group's height isn't constant — it's tall when the card is active (price row, weight buttons, Add to cart, Compare, shipping note) and much shorter when the position is "Temporarily unavailable" (just a label and a badge). Sizing the photo against a moving target means it only looks balanced in one of those two states. **Fix: give the photo column one fixed height that doesn't depend on its neighbors, and make the unavailable state a properly designed, comfortably-sized state on its own terms — not something that has to match anything to look right.**

Separately, inserting the bag next to the card in Part 7 ate into the card's own width, which is why text and buttons are now wrapping badly in the active state.

---

## Phase A — Give the card its width back

The bag is a narrow, tall product shape — it doesn't need much horizontal space, just vertical room to read clearly (per Part 8, sized comparably to the dial). In `BloomPage.tsx`'s `ArchetypeSection`:

- **Cap the bag's container width tightly** — something like `maxWidth: 100–120px` (an intrinsic-aspect-ratio box, not a wide flex percentage) — rather than letting it claim a flexible share of the row.
- **Let the card column reclaim the width the bag was taking.** After the bag is narrowed, re-check the card at the same viewport widths shown in the Fruity screenshot: "Balanced — Bright & Tart" should read on one or two lines, not three; the two weight buttons should sit side by side, not stack; "Add to cart" and "Compare" should stay on one row. If they still wrap after narrowing the bag, the card column needs more `flex`/`basis` — take it from the photo column first (see Phase C), not from the dial.

---

## Phase B — Design the "Temporarily unavailable" state properly

Today it renders as a small pill in whatever space is left over — that's what makes it look broken in the Balanced & Sweet screenshot, not just visually spare. Give it the same structural presence as the active card, at a comparable size, so it reads as a deliberate state rather than missing content:

- Same outer box treatment as the active `PositionCard` (rounded border, background, comparable padding) — not just an inline label-plus-badge floating in empty space.
- Give it a sensible **minimum height** close to what the active card typically occupies (title + one line of description + the badge, vertically centered), so the box itself has real presence even though there's less inside it — don't let it collapse to its minimal content height.
- The archetype heading (e.g. "Balanced & Sweet") should keep its normal large heading treatment and position regardless of whether the current position is active or unavailable — it shouldn't visually relocate or shrink based on card state, per the Balanced & Sweet screenshot where it currently looks displaced.
- Keep the bag visible in this state too (per Phase A's sizing), rather than hiding it — there's still a real archetype and dial to explore even when this specific position is out; only the purchase-specific content is unavailable.

---

## Phase C — Photo column: fixed height, not relative

Change the photo column's sizing from "match whatever the neighboring content produces" to a **fixed, absolute height cap that never changes**, regardless of whether the current position is active or unavailable:

- Pick the target height based on the **active** card's typical height (the taller, more common case) — roughly what's shown working reasonably well in the Fruity screenshot — and cap the photo column (hero + small photos, per Part 6) to that fixed value on every row, every archetype, every position state.
- This means on an unavailable-position row, the photo column's height no longer has anything to "match" dynamically — it's simply always the same size. Combined with Phase B giving the unavailable card real presence at a comparable size, the row should look balanced in both states without the photo needing to adapt row-by-row.

---

## Testing task

1. **Card width**: re-check the Fruity active-position card at the same viewport size as the screenshot — confirm no awkward text wrapping, weight buttons side by side, Add to cart/Compare on one row.
2. **Unavailable state**: re-check the Balanced & Sweet "Lively · Temporarily unavailable" position specifically — confirm the card box now has real presence (comparable size/padding to the active state), the archetype heading sits in its normal place, and there's no large stray empty space next to it.
3. **Photo consistency**: compare the photo column's height on an active-position row versus an unavailable-position row for the same or different archetypes — confirm it's now the same fixed height in both, not visibly different.
4. **Regression**: confirm the bag is still sized comparably to the dial (Part 8's fix) after narrowing its container width — this phase should only change its *width* allowance, not shrink it back down.
5. **Mobile and both flip orientations**: confirm all of the above holds on the mobile stacked layout and in both flip states, not just the two screenshots reviewed here.

---

## Out of scope for this part

- Part 5 (Find My Flavor reuse) — still on hold.
- Any change to which positions are active/unavailable (Phase 1a's stock logic) — this part only changes how the unavailable state *looks*, not when it triggers.

## Summary checklist

- [ ] Bag container width capped tightly; card column reclaims the space, no more text/button wrapping in the active state
- [ ] "Temporarily unavailable" card redesigned with real box presence and a sensible minimum height, matching the active card's structural weight
- [ ] Archetype heading position/size no longer shifts based on card state
- [ ] Photo column height changed from relative-to-neighbors to a fixed cap, consistent across active and unavailable rows
- [ ] Testing task completed, including a direct comparison against both screenshots reviewed here
