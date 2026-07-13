# Flavor Intelligence Page — Part 7: dimension bars become rectangles too

Parts 1–6 (this same folder) are live. Confirmed with Dana: now that the descriptor bars (Part 6, `CollaborativeFlavorWheel.tsx`) are sharp rectangles instead of rounded pills, the cupping profile bars (`DimensionBars.tsx` — Sweetness, Acidity, Bitterness, etc.) should match, so the two bar-based sections in the detail panel share one consistent visual language.

## Fix, in `coffee-info/DimensionBars.tsx`

Same change as Part 6, item 4 — drop `rounded-full` from every bar track/fill element. Confirmed against the current file, four instances in `DimensionBar()`:
- Line ~40: primary bar track (`h-1.5 rounded-full w-full`) → `h-1.5 w-full`
- Line ~42: primary bar fill (`absolute top-0 h-1.5 rounded-full transition-all duration-500`) → `absolute top-0 h-1.5 transition-all duration-500`
- Line ~49: comparison bar track → same change
- Line ~51: comparison bar fill → same change

**Also update the compare-mode legend swatches for full consistency** (`w-2 h-1.5 rounded-full inline-block`, three instances in `DimensionBars()` itself, one per legend item: primary/compare/"Notable difference") — drop `rounded-full` from these too so the tiny legend dashes match the actual bars they're representing, not left as pill-shaped leftovers next to rectangular bars.

Everything else in this file — the 0–15 scale math, the numeric `min–max/15` readout, the scale min/max labels, compare-mode stacking, session-count copy — is unchanged. This is purely the same corner-radius change Part 6 made, applied to the other bar component on this page.

**This file is shared with The Bloom** (same as `TastingNotes.tsx` in Part 5) — the rectangle treatment will apply there too. Given Dana's already confirmed shared-component consistency is desired (Part 5), no separate confirmation needed, but flagging it again since it's a repeatable pattern worth Claude Code double-checking each time: shared files under `coffee-info/` affect both pages, verify both after any change here.

## Testing

- Open any coffee's detail panel: confirm the cupping profile bars now have square corners, matching the descriptor bars below them.
- Compare mode: confirm both the primary and comparison bars, and the three legend swatches above them, are all rectangular now — no rounded piece left in this section.
- Regression check on `/bloom`: confirm dimension bars there also render as rectangles now, consistent with the rest of this pass.
