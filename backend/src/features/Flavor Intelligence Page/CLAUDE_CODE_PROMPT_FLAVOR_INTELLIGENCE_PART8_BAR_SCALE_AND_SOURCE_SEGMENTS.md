# Flavor Intelligence Page — Part 8: thicker bars, a dominance-clarity scale, and source-segmented color

Parts 1–7 (this same folder) are live. Dana reviewed the deployed bars again — the mentions/thickness fix and the rectangular shape both landed well ("the bars look better"). Three more refinements, all in `coffee-info/CollaborativeFlavorWheel.tsx`, confirmed with Dana after reviewing a mockup.

## a. Thicker bars

Current thickness range (Part 6): `4 + intensityRatio * 4`, i.e. 4–8px. Increase to `6 + intensityRatio * 6`, i.e. 6–12px. Simple constant change, same formula shape — adjust the two literals in `DescriptorBar()`, nothing structural.

## b. Rescale bar length for dominance clarity, not literal proportion — this is a marketing/communication decision, not a data-accuracy one

**Problem:** today's length formula (`totalMentions / maxMentions * 100`) lets the single strongest note hit 100% width — visually "maxed out," flush against the end of the row — while the weakest notes sit at an 8% floor, which still reads as more present than Dana wants. Her framing, worth keeping front and center for this and any future tuning: *"accuracy here is not important, what's important is creating a clear visual understanding about the dominance of each note."* This section exists to make a customer instantly read "this is the coffee's real character, this is a minor footnote" — not to be a faithful chart of the underlying counts.

**Fix — remap into a narrower visual band instead of the full 0–100% range**, using min-max normalization across the whole coffee's descriptor set (not the fixed 0–100 range, and not per-category — same global scope Part 6 already established for `maxMentions`, for the same reason: comparisons need to stay honest across category boundaries):

```tsx
const MIN_BAR_WIDTH_PCT = 5;  // was 8 — the weakest note should look genuinely minor
const MAX_BAR_WIDTH_PCT = 75; // was implicitly 100 — the strongest note should never look "maxed out"

function computeWidthPct(entry: DescriptorEntry, minMentions: number, maxMentions: number): number {
  if (maxMentions === minMentions) return MAX_BAR_WIDTH_PCT; // only one distinct value present — treat as dominant, not ambiguous
  const ratio = (entry.totalMentions - minMentions) / (maxMentions - minMentions); // 0–1, stretched across the real spread present
  return MIN_BAR_WIDTH_PCT + ratio * (MAX_BAR_WIDTH_PCT - MIN_BAR_WIDTH_PCT);
}
```
This is **min-max normalization**, not the current relative-to-max-only ratio — the reason: if every descriptor's mention count is close together (e.g. 1, 2, 2, 3), a relative-to-max ratio compresses everything toward the top of the range and undersells the spread; stretching the *actual* minimum-to-maximum spread present to fill the full `[5%, 75%]` band guarantees the top note and the bottom note are always clearly, visibly different, regardless of how close or far apart the raw numbers happen to be. This is the literal implementation of "accuracy isn't the point, clarity of ranking is."

Compute `minMentions`/`maxMentions` once, across **all** entries for the coffee (same place `maxMentions` is already computed today, in `GroupedDescriptorBars`, before category grouping and before the `VISIBLE_PER_CATEGORY` cap) — so expanding a category's "+N more" toggle doesn't shift the scale on entries already visible.

These two constants (5/75) are Dana's starting numbers, explicitly given as "maybe" — named constants specifically so they're trivial to retune after seeing them rendered, not something to treat as final on first pass.

## c. Bars should visually combine all three sources, not show one flat color per bar

**Problem:** today's bar renders in a single color — whichever source appears first in `entry.sources` — with the *other* sources only indicated by small dots next to the label. Dana wants the bar itself to show the blend.

**Fix — segment the filled portion of the bar by each source's share of mentions**, using data that's already there (`entry.sources: { source, mentions, avgIntensity }[]`, from Part 6 — no backend or data-model change needed, purely a rendering change):

```tsx
function DescriptorBar({ entry, minMentions, maxMentions, index }: { entry: DescriptorEntry; minMentions: number; maxMentions: number; index: number }) {
  const widthPct = computeWidthPct(entry, minMentions, maxMentions);
  const intensityRatio = entry.avgIntensity != null ? Math.min(entry.avgIntensity / 15, 1) : INTENSITY_DEFAULT_RATIO;
  const barHeightPx = 6 + intensityRatio * 6; // 6px–12px

  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: index * 0.04 }}>
      <p className="text-xs mb-1" style={{ color: '#5a4a3a' }}>{entry.descriptor}</p>
      <div className="w-full" style={{ height: barHeightPx, backgroundColor: '#e0dcd4' }}>
        <motion.div
          className="flex"
          style={{ height: '100%' }}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.5, delay: index * 0.04 + 0.1 }}
        >
          {entry.sources.map(s => (
            <div
              key={s.source}
              style={{ width: `${(s.mentions / entry.totalMentions) * 100}%`, height: '100%', backgroundColor: SOURCE_COLOR[s.source] }}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
```
Note the structure: the outer track is always full width (`w-full`), the middle `motion.div` animates to `widthPct` (the dominance-scaled length from part b), and *inside* that, the `entry.sources.map(...)` splits proportionally by each source's mention share — a customer's report that agrees with internal cupping should visibly enlarge that segment, not just add an extra dot.

**Remove the small per-row source dots** (`sourcesPresent.map(s => <span className="w-1.5 h-1.5 rounded-full" .../>)`) now that the bar itself carries the source breakdown — keeping both is redundant and adds clutter this redesign has been actively removing since Part 4. The section-level legend at the top (Internal cupping / Roastery notes / Customer feedback swatches) stays — that's the one place colors are labeled, everything below just uses them.

`sourcesPresent`/`barColor` (the old single-color variables) are no longer needed in `DescriptorBar` — replaced by the per-segment mapping above.

## Testing

- Bars are visibly thicker than the previous pass.
- Open a coffee with a clear dominant note (the "Grounded & Earthy" example, or similar): confirm the strongest note's bar stops short of the row's full width (around 75%, not flush to the edge), and the weakest visible note is a thin sliver (around 5%), with everything else spread clearly between — not clustered near either end.
- A descriptor observed by two sources shows a visibly two-toned bar (e.g. terracotta + sage segments), proportioned to roughly match how many mentions came from each — not just a single flat color with dots next to the label.
- A category where every entry has the exact same mention count: confirm it doesn't throw (the `maxMentions === minMentions` case) and renders sensibly rather than a division-by-zero blank bar.
- No numbers anywhere in this section, still — this stays a purely visual/qualitative section per Dana's earlier requirement, unchanged by this pass.
