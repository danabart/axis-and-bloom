# Flavor Intelligence Page — Part 4: Font standardization + notes-as-bars redesign

Parts 1–3 (this same folder) are live. Two more rounds of feedback from Dana, from looking at the deployed page. This file is grounded in the actual current code — `frontend/src/app/components/FlavorIntelligencePage.tsx` and `frontend/src/app/components/coffee-info/CollaborativeFlavorWheel.tsx` — read both before starting, this doc quotes them directly.

---

## Fix A — Font standardization, scoped to this page only

**Problem, from Dana directly:** the font isn't standardized — inconsistent size, and "the font itself." Confirmed with Dana: fix this page only, not a site-wide font overhaul (that's a separate, bigger decision for later if she wants it — see the root-cause note below for why).

**Root cause, found while investigating:** `frontend/src/styles/fonts.css` only loads one font file:
```css
@font-face {
  font-family: 'Lato';
  src: url('../design/FONT/Lato/Lato-Regular.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```
A single static Regular-weight TTF is declared across the *entire* weight range 100–900. Static font files don't interpolate weight — every `font-light` / `font-normal` / `font-medium` class used anywhere on the site currently renders as the same Regular glyphs (or triggers the browser's synthetic/fake bolding for anything requesting a heavier weight than what's loaded, which can look chunky and inconsistent next to real text). This is likely the real "the font itself" problem, not just inconsistent size choices. **Confirmed with Dana: don't fix `fonts.css` in this pass** — that's a shared file every page depends on, and properly fixing it means sourcing real Lato weight files (Light/Regular/Medium/Bold), which is a separate decision. For this page, work within the one weight that actually renders: stop requesting weights that don't exist.

**What to actually do, scoped to `FlavorIntelligencePage.tsx` itself (not the shared `coffee-info/` components — those are also used by The Bloom via `RevealedPanel.tsx`, and touching them would ripple outside this page, which is explicitly out of scope for this pass):**

1. **Audit every `font-light`/`font-normal`/`font-medium`/`font-bold` class in this file's own JSX** (the header block, personalized header, quiz banner, accordion section headers/cards, the detail panel header, compare-mode UI) and remove them where they're doing nothing (i.e. replace with no weight class at all, or a consistent explicit `font-normal` for code clarity — visually identical either way, but pick one convention and use it everywhere in this file rather than mixing "no class" and "font-normal" arbitrarily).
2. **Check `<button>` and `<select>` elements specifically for a font-family leak.** `theme.css`'s `@layer base` sets `font-size`/`font-weight`/`line-height` on `button`/`input`/`label` but never explicitly sets `font-family` on them — only `html`/`body` get it directly. Browsers' default UA stylesheets often give form controls the OS UI font instead of inheriting the page's body font unless something explicitly sets `font-family: inherit` (Tailwind's preflight usually handles this, but verify it's actually taking effect here rather than assuming). This page has several buttons and one `<select>` (the compare-mode section toggles, the "⇄ Compare" button, the coffee-select dropdown, the feedback "Not now" button) — check whether any of them are actually rendering in a different font than the surrounding text (inspect computed styles, don't guess), and if so, add `style={{ fontFamily: "'Lato', Arial, sans-serif" }}` (or a shared class) to whichever ones need it. This is a concrete, checkable hypothesis for "the font itself" looking inconsistent, not a guess to skip.
3. **Standardize the type scale by role, not by individually eyeballing each element.** Group every text element in this file into roles and give each role exactly one size (and confirm weight per the point above):
   - **Page title** — the H1 (`text-5xl md:text-7xl`). Unchanged, already distinct and fine.
   - **Section/card sub-heading** — used for things like the "Your match: {Archetype}" line, the selected coffee's name (`h2`), and (once Part 3's regression check confirms it still renders) the compare-mode coffee names (`h3`). **These currently use three different sizes** (`text-2xl`, `text-3xl`, `text-lg` respectively) for what is functionally the same role at different points in the page — pick one size for "this is the name of a coffee/archetype being highlighted" and use it consistently, or deliberately keep the main H2 one step larger than the others *on purpose* (fine either way) rather than by accident. Document the choice in a code comment so it doesn't drift again.
   - **Accordion section header label** (archetype name in the sidebar list) — currently `text-base`. Compare against the "section/card sub-heading" role above; if they're meant to feel like the same weight of information, consider aligning them, or confirm they're deliberately different tiers (top-level nav vs. content heading) and leave as-is — either is fine, just make it a decision, not an accident.
   - **Body/description text** — the subtitle under the H1, `dimCompText`, `renderSecondary()`'s copy. Currently a mix of `text-sm` and `text-lg`; the H1 subtitle at `text-lg` is appropriately larger (it's introductory copy), the rest at `text-sm` is fine — just confirm every instance of "regular body copy" in this file is one of these two, not a third size sneaking in.
   - **Micro/label text** — uppercase eyebrows, badges, pill tags, counts. Should all be `text-xs`; scan for any stray `text-[10px]` or similar one-off values and normalize to `text-xs` unless there's a specific reason (e.g. a badge that's deliberately smaller than a sibling label) — if there is a reason, leave a comment explaining it.

This is a code-consistency pass, not a visual redesign — the goal is that similar-purpose text looks the same everywhere on this page, using the one font weight that actually renders, not introducing new sizes or a new look.

---

## Fix B — Descriptor notes as bars, not bubbles, with no numeric labels

**Problem, from Dana directly:** the bubble cloud is visually misleading. Her example: a "Classic Chocolate" coffee where chocolate is unmistakably the dominant character, but the bubble cloud shows several fruit-note bubbles nearly as large as the chocolate one — because bubble *size* is `√(mentions/maxMentions)`, and square-root scaling compresses the visual gap between a note mentioned many times and one mentioned once or twice. To a non-expert customer, that reads as "why does a chocolate coffee taste like fruit?" — not the intended impression. Also fits the site's existing visual language better: `DimensionBars` already uses horizontal bars for the cupping profile section right next to this one; bubbles are the odd one out.

**Design confirmed with Dana, after reviewing a mockup:** bars, not bubbles — but explicitly **no numbers anywhere on them**, unlike `DimensionBars`. Dana's own framing: *"if the bar is long, it refers that the note is more intense... fruity notes should be smaller."* This should read as a qualitative hint, not a measurement — bar length alone carries the meaning, nothing next to it says "12" or "80%" or "8 mentions."

### Data: extend `aggregateDescriptors()` to compute an intensity value per descriptor

Current `WheelRow`/`DescriptorEntry` shapes (`coffee-info/CollaborativeFlavorWheel.tsx`):
```ts
export interface WheelRow {
  wheel_category: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
}
export interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  sources: { source: string; mentions: number }[];
  totalMentions: number;
}
```
`avg_intensity` already exists per row (per descriptor, per source) but `aggregateDescriptors()` currently only tracks `mentions`, discarding intensity entirely. Add an aggregate intensity to `DescriptorEntry`:
```ts
export interface DescriptorEntry {
  descriptor: string;
  wheel_category: string;
  sources: { source: string; mentions: number; avgIntensity: number | null }[];
  totalMentions: number;
  avgIntensity: number | null; // mentions-weighted average across sources; null if no source reported intensity for this descriptor
}
```
In `aggregateDescriptors()`, for each row where `row.avg_intensity != null`, accumulate `weightedSum += Number(row.avg_intensity) * Number(row.mentions)` and `weightedCount += Number(row.mentions)` (separately from `totalMentions`, since some rows may have mentions but no intensity value). Final `avgIntensity = weightedCount > 0 ? weightedSum / weightedCount : null`. This is the "how intense" signal, mentions-weighted so a descriptor consistently rated high by multiple mentions outweighs a single outlier mention.

### Bar length: relative to the coffee's own strongest note, not the fixed 0–15 scale

Compute `maxIntensity = Math.max(...allEntries.map(e => e.avgIntensity ?? 0), 1)` **across all descriptors for this coffee, before category grouping** — not per-category — so the comparison stays honest across category boundaries (chocolate should read as the longest bar on the whole page if it's genuinely the most intense note, even if a fruit note happens to be the top entry within its own smaller category). Each bar's width is `(entry.avgIntensity ?? MINIMUM_INTENSITY_FLOOR) / maxIntensity`. For entries with `avgIntensity === null` (mentioned but no intensity ever captured for them) — don't drop them, but don't guess a value either: give them a fixed short floor width (e.g. 18–22% of the max) so they read as present-but-unconfirmed rather than absent or, worse, arbitrarily sized.

### No `DimensionBars` reuse — this needs its own distinct look

Don't reuse `DimensionBars`' exact row layout (label | bar | numeric readout in a 3-column grid) — that's precisely the "spec sheet" look Dana wants this section to avoid. Use the stacked layout instead (label above, bar below, full row width), similar in spirit to what was mocked up:
```tsx
function DescriptorBar({ entry, maxIntensity, index }: { entry: DescriptorEntry; maxIntensity: number; index: number }) {
  const value = entry.avgIntensity ?? MINIMUM_INTENSITY_FLOOR_VALUE; // pick a real floor, e.g. maxIntensity * 0.2
  const widthPct = Math.max((value / maxIntensity) * 100, 8); // 8% absolute floor so even the smallest bar is visible, not a sliver
  const sourcesPresent = [...new Set(entry.sources.map(s => s.source))];
  return (
    <motion.div initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 0.4, delay: index * 0.04 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs" style={{ color: '#5a4a3a' }}>{entry.descriptor}</span>
        <div className="flex gap-0.5">
          {sourcesPresent.map(s => (
            <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLOR[s] }} title={SOURCE_LABEL[s]} />
          ))}
        </div>
      </div>
      <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: '#e0dcd4' }}>
        <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${widthPct}%`, backgroundColor: SOURCE_COLOR[sourcesPresent[0]] ?? '#b05642' }} />
      </div>
    </motion.div>
  );
}
```
(Reference sketch, not final — reuse the site's existing bar color/track conventions, `#b05642` fill / `#e0dcd4` track, same as `DimensionBars`, so the two sections feel related without being identical. The small colored dots preserve the three-source concept without a number attached to it.)

### Keep: category grouping, sort order, cap-and-expand

- Keep `groupByCategory()` and the SCA category sub-headers (Part 2 Decision #5) — change its internal sort from `totalMentions` to `avgIntensity` descending, since that's now the meaningful ordering for this presentation.
- Within each category group, show only the top 5 entries by `avgIntensity`; if more exist, a small `+N more, less prominent →` toggle (text link style, matching the existing "Show cupping session notes" expand pattern in `CuppingNotes`) reveals the rest. This directly addresses "too many minor notes competing for attention" alongside the length/scale fix — both the visual weight *and* the sheer count of what's shown by default should favor the dominant character.
- Replace `BubbleCloud`/`GroupedBubbleClouds` with the bar equivalents; keep the outer `CollaborativeFlavorWheel` wrapper, its source legend, and compare-mode side-by-side layout structurally the same — only the inner rendering (bubbles → bars) and the removal of numeric hover tooltips change. Drop the bubble's `title="..."` tooltip that spelled out mention counts — no numbers anywhere in this section now, including on hover.

---

## Testing

- Font: on this page specifically, confirm every heading/label of the same role now shares one size, and spot-check the compare-mode `<select>` and every `<button>` render in the same visual font as surrounding text (not a system-font fallback) — don't just read the code, actually inspect computed styles in devtools.
- Bars: open the "Classic Chocolate" coffee (or whichever coffee prompted Dana's original screenshot) and confirm chocolate (or whatever the dominant descriptor is) reads as clearly the longest bar, with minor fruit notes clearly and proportionally shorter — not just "somewhat smaller" the way the old bubbles were.
- Confirm no numbers, percentages, or mention counts appear anywhere in this section — text label, bar, small source dots, nothing else.
- A descriptor with no intensity data at all still renders (short floor-width bar), not dropped or broken.
- Expand a category with more than 5 descriptors: confirm the "+N more" toggle works and reveals the rest in the same style.
- Compare mode: confirm the two side-by-side bar lists both scale against their own coffee's max intensity independently (Coffee A's bars shouldn't be scaled against Coffee B's max, and vice versa) — each side tells its own honest story.
