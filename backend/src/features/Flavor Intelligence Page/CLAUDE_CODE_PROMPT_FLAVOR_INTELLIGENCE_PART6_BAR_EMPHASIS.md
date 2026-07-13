# Flavor Intelligence Page — Part 6: descriptor bars aren't showing a dominance signal

Parts 1–5 (this same folder) are live. Dana's latest screenshot of the Collaborative Flavor Wheel section shows every bar — Blueberry, Raspberry, Orange, Prune, Raisin, Chocolate, Smoky, Sweet Aromatics — rendering at essentially the same length. Nothing reads as more or less dominant. This defeats the entire point of Part 4's redesign (the original complaint was that a chocolate coffee's bubble cloud made fruit notes look nearly as prominent as chocolate — the bar version has the same problem, just in a new shape).

## Diagnosis — grounded in the actual current code, this isn't a coding bug, it's the wrong metric

Read `coffee-info/CollaborativeFlavorWheel.tsx` as it exists today: `DescriptorBar` computes width as `(entry.avgIntensity / maxIntensity) * 100`, where `maxIntensity` is the single highest `avgIntensity` across the whole coffee. The code is doing exactly what Part 4 specified. The problem is what it's specified to do: **cupping intensity scores for descriptors that get recorded at all tend to cluster in a moderate-to-strong range** — a cupper generally only notes a descriptor if it's reasonably present, so `avgIntensity` values across a coffee's descriptors are naturally close together (e.g. mostly 10–13 out of 15), even when how *often* or how *widely* those descriptors were observed varies a lot. Relative-to-max scaling on a tightly clustered value produces bars that are all close to full length — which is exactly what the screenshot shows. This is a metric-choice problem, not a rendering bug.

Dana's own diagnosis, and the fix: bring back what actually worked before — **mention count** was the signal that made the old bubble cloud show real variation (a note observed by two sources/sessions vs. one observed once). The bubble version's flaw wasn't using mentions, it was using `√mentions` (Part 4's original complaint) — square-root compresses the very differentiation that made mentions useful in the first place. Fix: use mentions **linearly** as bar length (no square root this time), and keep intensity as a secondary signal — bar *thickness*, not length — since Dana specifically asked for "longer... and bold," which reads naturally as two different visual properties, not one.

## Fix, in `coffee-info/CollaborativeFlavorWheel.tsx`

**1. Sorting — switch from `avgIntensity` to `totalMentions` everywhere it currently sorts by intensity:**
- `aggregateDescriptors()`'s final `.sort()`: from `(b.avgIntensity ?? 0) - (a.avgIntensity ?? 0)` to `b.totalMentions - a.totalMentions`.
- `groupByCategory()`: sort entries within each group by `totalMentions` instead of `avgIntensity`; rename `CategoryGroup.maxIntensity` to `maxMentions` (`sorted[0]?.totalMentions ?? 0`), and sort the groups themselves by `maxMentions` instead of `maxIntensity`.

**2. Bar length — drive it from `totalMentions`, not `avgIntensity`.** Mentions is always a positive integer for any entry that exists (it comes from `COUNT(*)`), so the `NO_INTENSITY_FLOOR_RATIO` null-handling in `DescriptorBar` is no longer needed for length — every entry has a real mentions value to scale from:
```tsx
function DescriptorBar({ entry, maxMentions, index }: { entry: DescriptorEntry; maxMentions: number; index: number }) {
  const widthPct = Math.max((entry.totalMentions / maxMentions) * 100, MIN_BAR_WIDTH_PCT);
  const intensityRatio = entry.avgIntensity != null ? Math.min(entry.avgIntensity / 15, 1) : INTENSITY_DEFAULT_RATIO;
  const barHeightPx = 4 + intensityRatio * 4; // 4px (low intensity) to 8px (high intensity)
  const sourcesPresent = [...new Set(entry.sources.map(s => s.source))];
  const barColor = SOURCE_COLOR[sourcesPresent[0]] ?? '#b05642';

  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: index * 0.04 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs" style={{ color: '#5a4a3a' }}>{entry.descriptor}</span>
        <div className="flex gap-0.5">
          {sourcesPresent.map(s => (
            <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLOR[s] }} title={SOURCE_LABEL[s]} />
          ))}
        </div>
      </div>
      <div className="w-full" style={{ height: barHeightPx, backgroundColor: '#e0dcd4' }}>
        <motion.div
          style={{ height: barHeightPx, backgroundColor: barColor }}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.5, delay: index * 0.04 + 0.1 }}
        />
      </div>
    </motion.div>
  );
}
```
Add `const INTENSITY_DEFAULT_RATIO = 0.6;` near the other constants (`MIN_BAR_WIDTH_PCT`, `VISIBLE_PER_CATEGORY`) — used when a descriptor has mentions but no source ever recorded an intensity for it, so it renders at a neutral mid-thickness rather than looking artificially thin or thick from missing data. `NO_INTENSITY_FLOOR_RATIO` can be removed entirely — nothing needs a length floor for missing intensity anymore, since length no longer comes from intensity.

**3. Thread `maxMentions` instead of `maxIntensity` through `CategoryBarGroup` and `GroupedDescriptorBars`** — same shape, just renamed and recomputed from `totalMentions`:
```tsx
function GroupedDescriptorBars({ entries }: { entries: DescriptorEntry[] }) {
  if (!entries.length) return null;
  const maxMentions = Math.max(...entries.map(e => e.totalMentions), 1);
  const groups = groupByCategory(entries);
  return (
    <div className="space-y-6">
      {groups.map(group => (
        <CategoryBarGroup key={group.category} group={group} maxMentions={maxMentions} />
      ))}
    </div>
  );
}
```
(`CategoryBarGroup` just forwards `maxMentions` to each `DescriptorBar` the same way it forwarded `maxIntensity` before — no logic change there beyond the rename.)

**4. Bars are sharp rectangles, not rounded pills.** Confirmed with Dana after reviewing a mockup: drop `rounded-full` (and any `border-radius`) from both the track and fill — square corners, not the pill shape the rest of the site's badges use. This intentionally makes the bars read as a distinct, more graph-like element rather than another rounded UI chip, which fits a "flavor intelligence" data section better. Applies to both divs in the snippet above (already reflected there — track and fill are plain rectangles with no rounding class).

**5. Do not use font weight/boldness on the descriptor label text as part of this signal.** Dana used the word "bold" but the bar-thickness change above is what should carry that meaning, not literal `font-bold` on the label — Part 4 found that `fonts.css` only loads one Lato weight site-wide, so a `font-bold` class on the label would currently be a no-op (or trigger inconsistent browser fake-bolding), the same problem Part 4 was fixing elsewhere. Bar thickness and length are real, working visual signals right now; font weight isn't, until the separate site-wide font fix Dana deferred happens.

## Testing

- Reopen the same coffee from Dana's screenshot: confirm the bars now show real, visible length variation — the most-mentioned descriptor(s) should read as clearly longer than a descriptor mentioned once.
- Confirm bar thickness also visibly varies — a descriptor with a high recorded intensity should look chunkier than one with a low or missing intensity, independent of its length.
- Confirm sort order (both within a category and category order itself) now follows mentions, and that order visually matches what the bar lengths show — no case where a shorter bar appears above a longer one.
- A descriptor with mentions but no intensity data at all: renders at the neutral default thickness, not broken, not oddly thin/thick.
- Re-check the cap-and-expand behavior (`VISIBLE_PER_CATEGORY`) and compare mode still work — this change touches sorting and sizing, not the grouping/cap/compare structure, but confirm nothing regressed.
- Still no numbers, percentages, or mention counts printed anywhere in this section — only length and thickness carry the signal, exactly as before.
