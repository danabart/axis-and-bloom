# The Bloom — Part 6: balance the photo/dial/card row, close the gap before the reveal panel

**Prerequisite: Parts 1–4 are deployed** (Part 5 is on hold — do not start it as part of this pass). This is a visual fix based on a screenshot Dana took of the live `/bloom` page (`Capture.JPG`, same folder as this prompt) showing the Fruity archetype section.

## The problem, diagnosed from the screenshot

In `BloomPage.tsx`'s `ArchetypeSection` (the three-column row: photo `md:basis-[34%]`, dial `md:basis-[26%]`, card `md:flex-1`), **the photo column is significantly taller than the other two**, because it stacks a full hero photo (4:3 aspect ratio, full column width) on top of two more square photos in a grid below it. The dial column (dial wheel + label + bag image) and the card column (archetype heading + collapsed card) are both naturally much shorter.

Since all three columns sit in one flex row, the row's total height is dictated by the tallest child — the photo column. That produces two visible problems in the screenshot: the three columns look visually unbalanced/misaligned (the photo dominates while the other two look small and stranded with blank space around them), and — since Part 4's `RevealedPanel` renders as a full-width block *after* this row closes — there's a large empty gap between where the card/dial content actually ends and where the row (and therefore the reveal panel) actually ends, because the tall photo column is still extending down past that point.

**Fixing the height imbalance fixes both problems at once** — no separate fix is needed for the "gap before the reveal panel," it should close on its own once the row's height is no longer dictated by an oversized photo column.

---

## Fix: bring the photo column's height down to roughly match the dial and card columns

In `BloomPage.tsx`'s `ArchetypeSection` (photo column currently ~lines 94–116):

- **Narrow the photo column** — reduce `md:basis-[34%]` to something smaller, roughly `md:basis-[26%]` to `md:basis-[28%]`, closer to the dial column's width. Since the hero photo is `aspectRatio: '4/3'` at full column width, narrowing the column directly shrinks its height too.
- **Also cap the hero photo's absolute height** (don't rely on width-narrowing alone, since column width still varies by viewport) — e.g. `maxHeight` around 220–260px on the hero's container, keeping `objectFit: 'cover'` so it crops rather than distorts.
- **Reduce the two small supplementary photos** proportionally — smaller grid cells, or tighter `gap`. **If shrinking them still leaves the column taller than the dial/card columns, drop them from this layout entirely and keep only the hero, sized to match** — Dana's instruction was to resize, but a hero-only photo column is a reasonable fallback if resizing alone can't hit proportional balance without looking cramped. Use judgment on which looks better; both are acceptable outcomes.
- **Remove `md:sticky md:top-[100px]` from the photo column.** Confirmed with Dana — it's not intentional/load-bearing (nobody was sure why it was there), and once the columns are height-balanced it has no clear purpose. Just take it out rather than treating it as a judgment call.
- **Goal, not a fixed number**: the three columns' bottom edges should land close to each other — verify this visually against the actual rendered page (or updated screenshots), not just by matching the numbers above exactly. The dial column's height was already tuned in Part 4 (wheel `clamp(130px, 14vw, 190px)` + bag `maxHeight: 160`) — treat that as the natural target height for the row, and bring the photo column down to it rather than adjusting the dial/card columns to match the photo.

---

## Verify: the gap before the reveal panel

Once the row is height-balanced, re-check the reveal flow specifically:

- Click "Reveal the full profile" on a card and confirm `RevealedPanel` now appears directly below the row with no large empty gap — if there's still a noticeable gap after the row-height fix, look for an explicit `marginTop`/`paddingTop` on `RevealedPanel` or its wrapper that might be adding space independent of the row-height issue, and trim it.
- Confirm this looks correct in **both flip orientations** (`flip`/`md:flex-row-reverse` vs `md:flex-row`) — the row-height fix should be orientation-independent, but verify rather than assume.

---

## Mobile check

Dana's note: mobile support was already requested and (per her understanding) already implemented — this row is `flex-col` on mobile, `md:flex-row` at the `md` breakpoint, so photo/dial/card already stack vertically on small screens rather than sitting in a row. **This part's changes are desktop-row-height changes and shouldn't affect the mobile stacked layout**, but re-check mobile after making them anyway — narrowing the photo column's `md:basis` value or capping its height with a fixed `maxHeight` (rather than something viewport-relative) has a small chance of interacting oddly with the mobile breakpoint if any of the new values aren't properly scoped to `md:` and above. Confirm mobile still looks like it did before this part, not different.

---

## Testing task

1. **Visual comparison**: re-screenshot the same Fruity section (or another archetype) after the fix and compare column heights directly against `Capture.JPG` — confirm the photo, dial, and card columns now end at roughly the same height, rather than the photo running noticeably longer.
2. **Reveal panel gap**: confirm no large empty gap between the row and `RevealedPanel` when a card is expanded, in both flip orientations.
3. **Cropping check**: since the hero photo now likely uses `objectFit: cover` at a smaller height, confirm the crop still looks intentional (important part of the photo not cut off) for a few different archetypes' hero images, not just Fruity.
4. **Mobile regression**: confirm the mobile stacked layout is unchanged from before this part.
5. **Sticky removed**: confirm scrolling through the section looks correct with the photo column now in normal flow — no jarring jump, nothing appearing to "float" oddly.

---

## Out of scope for this part

- Part 5 (reusing the archetype section on Find My Flavor) — explicitly on hold, not part of this pass.
- Any changes to the photo files themselves (still deferred, per `IMAGE_PERFORMANCE_FINDINGS.md`) — this is a layout/sizing fix only, not a re-export or recompression of the images.
- Any changes to the dial or card column's own internal content — only their relative balance against the photo column.

## Summary checklist

- [ ] Photo column narrowed (`md:basis-[34%]` → roughly `26–28%`) and height-capped to match the dial/card columns
- [ ] Small supplementary photos shrunk, or dropped if shrinking alone doesn't achieve balance
- [ ] `position: sticky` removed from the photo column
- [ ] Gap before `RevealedPanel` confirmed closed in both flip orientations
- [ ] Mobile layout confirmed unchanged
- [ ] Testing task above completed, including a direct before/after visual comparison
