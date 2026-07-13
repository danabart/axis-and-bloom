# Flavor Intelligence Page — Part 5: fix the oversized surprise-note text in TastingNotes.tsx

Parts 1–4 (this same folder) are live. Dana reviewed the deployed page again (confirmed: Parts 3 and 4 are both live — the two-column layout and the bar-based notes redesign are both visible in her latest screenshot) and the font standardization from Part 4 didn't cover the actual outlier, because it lives outside the file Part 4 touched.

## The problem, confirmed against the real file

Part 4 explicitly scoped the font fix to `FlavorIntelligencePage.tsx` only, deliberately excluding the shared `coffee-info/` components (reasoning at the time: they're also used by The Bloom via `RevealedPanel.tsx`, so touching them ripples outside this page). Dana's new screenshot shows a "Grounded & Earthy" coffee where the surprise-note blockquote — *"Despite its heavy, syrupy body and dark intensity, this coffee is almost shockingly dry on the palate..."* — renders visibly larger than everything around it: the badges, the compatibility text above it, and the "Three voices" paragraph directly below it.

Confirmed in `frontend/src/app/components/coffee-info/TastingNotes.tsx` — this is exactly where it lives, and it's a real, measurable size jump, not just a visual impression:

| Element | Current class |
|---|---|
| Surprise note (the outlier) | `text-lg font-light` (18px) |
| Three-voice story paragraph | `text-base font-light` (16px) |
| "Liam's intake" AI note, expanded | `text-base font-light` (16px) |
| "Liam's intake" AI note, collapsed | `text-sm font-light` (14px) |

Every other block of body copy in this file is 16px or smaller; the surprise note alone is 18px — that's the jump Dana is seeing.

**Confirmed with Dana: fix it in the shared component, not with a page-specific override.** The Bloom also benefits from the same consistency (it renders this exact component too, via `RevealedPanel.tsx`), and there's no reason to want the surprise note to look different size-wise between the two pages.

## Fix

In `TastingNotes.tsx`:
1. Change the surprise note's class from `text-lg font-light leading-relaxed` to `text-base font-light leading-relaxed` — matching the three-voice story and expanded AI note. Keep its distinct *treatment* (the left border, the color, the paragraph spacing) — that's what should signal "this is a different kind of note," not a bigger font size on top of it. Losing the size difference doesn't lose the visual distinction; the border + color already carry that.
2. While in this file: `font-light` is a no-op today (Part 4's finding — `fonts.css` only loads one Lato weight, so every `font-light`/`font-normal` request renders identically). Clean up the same way Part 4 did for `FlavorIntelligencePage.tsx`: remove `font-light` from every element in this file where it's not doing anything, or standardize on a single explicit convention rather than leaving it scattered — don't leave this file as the one place still carrying dead weight-class references after Part 4 cleaned up the page that renders it.
3. Double check `<button>` elements in this file too (the "Read full note ↓ / Collapse ↑" toggle) for the same font-family-inheritance check Part 4 flagged for `FlavorIntelligencePage.tsx`'s buttons — confirm it's actually rendering in the inherited body font, not a system default.

## Testing

- Open the same "Grounded & Earthy" coffee (or any coffee with a surprise note) and confirm the blockquote text now matches the size of the "Three voices" paragraph beneath it — no visible jump between them.
- Confirm the surprise note is still visually distinguishable as its own thing (left border + color), just not via a different font size.
- Open `/bloom`, reveal a card's full panel, and confirm the same surprise-note sizing looks consistent there too — this file is shared, so this is a real regression check, not a formality.
- Re-scan this file for any other stray `text-lg` (or larger) body-copy sizes that might have the same problem and weren't caught above.
