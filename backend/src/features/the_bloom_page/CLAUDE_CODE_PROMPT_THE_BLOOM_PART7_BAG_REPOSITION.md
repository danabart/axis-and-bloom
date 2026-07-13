# The Bloom — Part 7: move the bag between the dial and card, close the remaining gap

**Prerequisite: Parts 1–4 are deployed. Part 6 may or may not have been run yet — this part re-verifies Part 6's goal (balanced row height, no gap before the reveal panel) using a cleaner mechanism, so it supersedes Part 6 where they overlap rather than assuming Part 6 fully landed.** Part 5 stays on hold, not part of this pass.

## Why this instead of just shrinking the photo further

Dana's screenshot (`Capture3.JPG`, same folder) still shows a gap between the archetype card and its expanded drill-down content, even after Part 4's fixes. The root issue Part 6 identified — row height dictated by whichever column is tallest — is still real, but capping the photo size alone means guessing at a target height. A cleaner fix: **restructure what's in each column so the row's height is naturally short and predictable, then size the photo to match that, instead of the other way around.**

Today, the bag image sits stacked underneath the dial (`BloomPage.tsx`, dial column ~lines 118–137), which is what makes that column tall. Moving the bag out from under the dial and placing it as its own element **between the dial and the card, positioned close to the card** removes that stacking entirely — the dial column becomes just the dial (short), and the bag sits adjacent to the card instead (the card's own height already comfortably fits the bag beside it, per the sizing in `Capture3.JPG`).

---

## Phase A — Reposition the bag

In `BloomPage.tsx`'s `ArchetypeSection`:

- **Remove the bag `<img>` from the dial column** (currently right after `<BloomDialWidget />`, ~lines 130–136). The dial column becomes just the dial widget — tag, direction row, wheel, position label/description — nothing stacked beneath it.
- **Add the bag as its own segment, positioned between the dial column and the card column, close to the card.** Concretely: either (a) a new, narrow flex child sitting between the existing dial column and the card column (e.g. `flex: 0 0 12–14%`), or (b) nested inside the card column's own flex container as a sibling to `PositionCard`, positioned on the side facing the dial. Either structural approach is fine — the visual result should be the bag sitting immediately next to the card, on the dial-facing side, not merged into the card's own box and not left under the dial.
- **Size the bag to roughly match the card's height**, not its own previous fixed size — the card (heading + collapsed `PositionCard`) is the tallest reliable content in that cluster now; let the bag's height target that rather than an arbitrary cap. `objectFit: 'contain'` (as today) so it doesn't distort.

---

## Phase B — Re-verify the row balance with the bag removed from the dial column

With the bag gone from beneath it, the dial column is now short — likely the shortest of the three remaining groups (dial-only, bag+card, photo). **Shrink the photo column to match whichever of the other two is now tallest** (almost certainly the bag+card group, since the dial alone is quite compact). This is the same goal Part 6 described; re-apply it now that there's a shorter, more predictable target:

- Narrow/height-cap the photo column as Part 6 specified (roughly `26–28%` width, capped height, `objectFit: cover`).
- If Part 6 already removed `position: sticky` from the photo column and reduced/dropped the two small supplementary photos, leave those as they are — just re-tune the exact height target now that the comparison column (bag+card) is shorter than it was when Part 6 was written. If Part 6 wasn't run yet, apply all of it now as part of this pass: remove `position: sticky`, narrow and height-cap the photo column, shrink or drop the two small photos if needed to hit the target.

---

## Phase C — Verify the gap is actually gone

Re-check the specific thing in `Capture3.JPG`: expand a card ("Reveal the full profile") and confirm `RevealedPanel` now appears directly below the row with no visible empty space, for the same archetype shown in the screenshot (Fruity) and at least one other.

---

## Testing task

1. **Bag placement**: confirm the bag renders between the dial and card, close to the card, at a size that looks intentional (not stretched, not tiny) relative to the card next to it — check this across a few different archetypes since bag artwork proportions may vary slightly.
2. **Dial column**: confirm it looks complete and balanced on its own now that the bag isn't stacked beneath it — not oddly empty at the bottom.
3. **Row height / gap**: re-screenshot the same section shown in `Capture3.JPG` and confirm no gap between the row and the expanded drill-down content.
4. **Mobile**: confirm the bag's new position collapses sensibly in the mobile stacked layout (`flex-col`) — it shouldn't end up in a confusing order (e.g., appearing before the dial it's meant to sit near, or awkwardly separated from the card).
5. **Flip orientation**: confirm the bag-between-dial-and-card arrangement looks correct in both `flip` states, not just the one shown in the screenshot.

---

## Out of scope for this part

- Part 5 (Find My Flavor reuse) — still on hold.
- Any change to the bag artwork itself or the dial's own internal sizing (Part 4's wheel dimensions stay as they are) — this part only changes *where* the bag sits, not the dial or the bag image itself.

## Summary checklist

- [ ] Bag image removed from beneath the dial
- [ ] Bag repositioned between the dial and card columns, close to the card, sized to roughly match the card's height
- [ ] Photo column re-balanced against the new (shorter) dial/bag/card grouping — sticky removed, size capped, small photos shrunk or dropped if needed (whether newly applied here or carried over from Part 6)
- [ ] Gap before the reveal panel confirmed closed, matching the specific case in `Capture3.JPG`
- [ ] Testing task completed, including mobile stacking and both flip orientations
