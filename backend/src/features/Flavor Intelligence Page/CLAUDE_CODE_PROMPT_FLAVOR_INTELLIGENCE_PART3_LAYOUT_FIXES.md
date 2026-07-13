# Flavor Intelligence Page — Part 3: Layout fixes from Dana's post-deploy review

Parts 1 and 2 (this same folder) shipped and are live at `/flavor-intelligence`. Dana reviewed it with real screenshots and flagged three specific problems. This file is grounded directly in the actual deployed `frontend/src/app/components/FlavorIntelligencePage.tsx` as it exists today — read it first, the line references below are real, not approximate.

## Fix 1 — Two-column layout: accordion on the left, detail panel takes the majority of the screen on the right

**Problem, from Dana directly:** the archetype accordion and the selected-coffee detail panel currently stack vertically in one column — accordion at the top, detail panel below it, requiring a scroll to see both. This isn't nicely presented. She wants the original page's two-column structure back: a narrower left column for the archetype list, and the majority of the screen on the right for whichever coffee is selected — this is how `CoffeesPage.tsx` was laid out before this rebuild (`flex flex-col lg:flex-row gap-12`, sidebar `lg:w-64 flex-shrink-0`, detail panel `flex-1 min-w-0`), and that relationship needs to come back, just with the sidebar now holding the accordion instead of a flat list.

**Current structure** (`FlavorIntelligencePage.tsx`, the return statement): everything — feedback nudge, personalized header, quiz banner, the accordion (`{/* ── 4. Archetype accordion ── */}`, `mb-16`), and the selected coffee detail panel (`{/* ── 5. Selected coffee detail panel ── */}`) — lives in one `<div className="px-8 md:px-16 max-w-[1100px] mx-auto pb-32">`, stacked top to bottom.

**Change:**
1. Keep the header block (title/H1/subtitle) and the feedback nudge / personalized header / quiz nudge banner exactly where they are — full-width, above everything else. Dana's feedback is specifically about the accordion/detail-panel relationship, not these.
2. Below that, wrap the accordion and the detail panel in a two-column flex row instead of two stacked full-width blocks:
   ```tsx
   <div className="flex flex-col lg:flex-row gap-12">
     {/* Left: archetype accordion */}
     <div className="lg:w-80 flex-shrink-0">
       {matchSection && renderSection(matchSection)}
       {adjacentSections.map(a => renderSection(a, 'Worth exploring'))}
       {isMatched && (matchSection || adjacentSections.length > 0) && restSections.length > 0 && (
         <p className="text-xs uppercase tracking-widest py-4" style={{ color: '#b8b0a4' }}>Explore other flavor families</p>
       )}
       {restSections.map(a => renderSection(a))}
     </div>

     {/* Right: selected coffee detail panel — majority of the width */}
     <div className="flex-1 min-w-0">
       {selectedSlotData ? (
         /* existing detail panel JSX, unchanged internally */
       ) : (
         <div className="py-16 text-center" style={{ color: '#a09880' }}>
           <p className="text-lg">Select a coffee to see its flavor intelligence.</p>
         </div>
       )}
     </div>
   </div>
   ```
   The `{selectedSlotData && (...)}` guard becomes `{selectedSlotData ? (...) : (<empty state>)}` — today, if nothing is selected yet, the right column would just be blank; add the empty state above so it doesn't look broken. In practice this should rarely show since Decision #3's default-selection logic auto-selects something on load, but it's a real reachable state (e.g. a brief moment before that effect runs, or if `archetypes` loads with zero active slots) and shouldn't render as visually empty.
3. Widen the outer container to give the two columns room — change `max-w-[1100px]` (both the header block's wrapper and this content wrapper) to `max-w-[1400px]`, matching the width the original single-coffee-page layout used for the same two-column relationship. `1100px` was sized for a single stacked column; it's too narrow once there's a sidebar and a majority-width detail pane side by side.
4. Card buttons inside `renderSection()` currently use `flex flex-wrap gap-3` with `min-w-[180px]` per card — fine to leave as-is, but note the available width per row will now be `lg:w-80` minus padding (roughly 320px), so most archetype sections will show one card per row instead of several side by side. That's expected and fine for a sidebar-width column; don't fight it by shrinking `min-w-[180px]` just to force more columns — a narrower list reads better here than a cramped multi-column grid.
5. Not required, but worth considering if it reads awkwardly once built: the left column could become `sticky top-24 self-start` so it stays in view while a long detail panel scrolls on the right (a common pattern for this exact sidebar/detail shape). Dana didn't ask for this explicitly — treat it as an easy add if the plain (non-sticky) version feels wrong once you see it rendered, not as a required part of this fix.

## Fix 2 — Remove the duplicate "Flavor Intelligence" title

**Problem, from Dana directly:** "Flavor Intelligence" appears twice at the top of the page — once as the small uppercase eyebrow label, once as the large H1 directly below it. Remove the smaller one.

**Current code** (header block):
```tsx
<p className="uppercase tracking-widest text-xs mb-3" style={{ color: '#b05642' }}>Flavor Intelligence</p>
<h1 className="text-5xl md:text-7xl font-normal leading-tight mb-4" ...>
  Flavor Intelligence
</h1>
```
The eyebrow used to say "Our Coffees" (a distinct label above the "Flavor Intelligence" H1) before this rebuild — it looks like it got changed to match the nav label during Part 2 and ended up duplicating the H1 instead of complementing it.

**Change:** delete the eyebrow `<p>` line entirely. Keep just the H1 and the subtitle paragraph below it. Don't reintroduce a different eyebrow string as a "fix" (e.g. putting "Our Coffees" back) unless Dana asks for one — she said to remove it, not replace it.

## Fix 3 — Remove the "Archetype intelligence" stats table from inside each accordion section

**Problem, from Dana directly:** opening an archetype section shows an unexpected table (screenshot: "ARCHETYPE INTELLIGENCE" header, then rows like "Sweetness — target 7.0–9.0 (ideal 8.0) · avg 7.00 across 4 coffees cupped in this family"). She doesn't want it — she wants the page to show what it showed before this redesign (the per-coffee content: AI notes, dimension bars, descriptor wheel, etc.), not this new family-level aggregate table. Remove it.

This is `StatsPanel` (Part 2 Decision #7's "archetype intelligence" panel) — in practice it didn't land well and Dana wants it gone, not just re-styled. Remove it cleanly rather than hiding it, since leaving the fetch/state around with nothing rendering it is just dead weight:

1. Delete the `StatsPanel` function component entirely (the block starting `// ── Archetype intelligence stats panel (Decision #7) ──` through its closing `}`).
2. Delete the `<StatsPanel stats={...} loading={...} />` call inside `renderSection()`, right after the `activeSlots.map(...)` card grid.
3. Delete the `statsByArchetype`/`statsLoading` state declarations and simplify `toggleSection()` back to just the expand/collapse toggle — remove the `fetch('/api/coffees/archetype-stats?archetype=...')` call and its `.then`/`.catch`/`.finally` chain entirely, not just the render.
4. Delete the now-unused `StatDimension`/`ArchetypeStats` interfaces if nothing else in the file references them (double-check — as of this writing they're only consumed by the pieces being removed above).
5. **Leave the backend endpoint alone.** `GET /api/coffees/archetype-stats` (Part 1 Decision #3) doesn't need to be deleted — it's harmless sitting unused, and this might be worth revisiting later in a different presentation (a tooltip, a separate stats view, whatever) rather than inline in the accordion. This fix is about removing the frontend consumption of it, not the backend capability.

---

## Testing

- Two-column layout: on a normal desktop width, confirm the accordion sits in a visibly narrower left column and the detail panel occupies the majority of the remaining width, side by side, no scrolling required to see both at once for a typical viewport.
- Resize down to mobile width: confirm it falls back to a single stacked column (`flex-col` below the `lg` breakpoint) rather than squeezing two columns into a narrow screen.
- Load the page fresh (no selection made yet, if that state is reachable): right column shows the new empty state, not blank space.
- Confirm the eyebrow label above the H1 is gone and only one "Flavor Intelligence" appears at the top of the page.
- Expand any archetype section: confirm no "Archetype intelligence" table appears, and confirm the network tab shows no request to `/api/coffees/archetype-stats` firing on expand (the dead fetch should be gone, not just the render).
- Full regression pass on everything Part 2's original testing section already covered (UC0–UC4 personalization, deep links, compare mode, cupping notes) — this is a layout change wrapping existing logic, but confirm nothing broke in the reshuffle, particularly the scroll-into-view-on-deep-link behavior (`pendingScroll`/`cardRefs`) now that cards live in a narrower column.
