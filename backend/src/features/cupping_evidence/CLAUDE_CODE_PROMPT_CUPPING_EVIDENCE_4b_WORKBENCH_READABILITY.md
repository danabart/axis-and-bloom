# Cupping Evidence, brief 4b: make the Calibration workbench readable. Layout and type only; no logic, no endpoint, no schema.

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-21 (review session, from the live page at 1568 px wide; Dana: "very hard to read") · Model: Sonnet is fine
> Status: NOT EXECUTED · Depends on brief 4 (deployed). Before/after: `workbench_before_2026-10-21.jpg` in this folder is what Dana sees today.
> Scope: `frontend/src/app/components/admin/AdminCalibrationWorkbench.tsx`, `EvidencePanel.tsx`, `CalibrationPanel.tsx` (where shared), and nothing else. Every read and write stays exactly as it is.

## What is wrong, from the screenshot

1. **The three panes don't fit.** The grid is `minmax(220px,1fr) minmax(360px,2fr) minmax(320px,1.4fr)` inside the admin's content width (about 1200 px at a 1568 px window with the sidebar). The evidence pane ends up about 340 px wide.
2. **The Archetype & slot tab puts two definition lists side by side** (`grid-cols-1 lg:grid-cols-2`) inside that 340 px. Each list has a label column and a value column, so values get about 60 px: "med-strong" wraps to three lines, Camila's call note wraps one word per line, the Catalog list's labels overprint the Evidence list's values ("no call Archetype"), and the catalog values are clipped off the right edge ("C&N bo", "roast dr", "roaster disagre"). This is the tab the pass lives on, and it is unreadable.
3. **Everything is 12 px or smaller** (`text-xs` throughout, `text-[11px]` for the basis preview). The rest of the admin (AdminCatalog) uses `text-sm` for body. The queue, the tabs, the cards and the evidence tables are all a size down from the page around them.
4. **The basis preview** is a grey block of 11 px text with no structure; it is the most important thing on the page and the hardest to read.
5. **Slot radios** wrap their name onto two lines with the band text wrapping underneath, so the four options don't align.
6. **Descriptors tab**: every website note repeats "website · Joe Bean Roasters (shop.joebeanroasters.com) · 2026-10-18" inline, so the mapping (the useful part, "Turbinado Sugar → Brown Sugar") is buried.
7. **Dimensions tab** is readable but cramped; the header "Rank ours / theirs" and the "1 / 1.5 of 4" cells need a key.

## Decisions (Dana, 2026-10-21). Do not re-open.
1. No logic change. Same reads, same writes, same component tree, same reuse of brief 3's panels. If a fix needs a new prop, it is a display prop.
2. Body text is `text-sm` (14 px) everywhere on the workbench and the evidence panel; labels and eyebrows `text-xs` uppercase; numbers `tabular-nums`. Nothing on the page is 11 px.
3. The evidence pane never falls below 560 px. Panes stack before they squeeze.
4. The Archetype & slot tab is never two columns of definition lists.

## PART A: the pane layout (`AdminCalibrationWorkbench.tsx`)
- Grid at ≥ 1440 px content width: queue `260px`, evidence `minmax(560px, 1fr)`, decisions `380px`, gap 24 px.
- Between 1024 and 1440 px: queue becomes a top strip above the other two (a horizontal, scrollable list of coffee chips with the flag / basis dots and the three counters on the left); evidence `minmax(560px, 1fr)` and decisions `360px` side by side.
- Below 1024 px: single column, queue strip, evidence, decisions.
- Use CSS grid with container queries or Tailwind breakpoints on the workbench root; measure the content width, not the window (the admin sidebar is 150 px).
- The page header ("Roastery Feedback", its one-line description, "Back to the roastery", "Calibration workbench: <roaster>") keeps its text but takes two lines less vertical space: the long explanatory sentence under the workbench title becomes a `title` tooltip on an info icon.

## PART B: the Archetype & slot tab (`EvidencePanel.tsx`)
One column, two stacked blocks, each a definition list with `grid-template-columns: 11rem 1fr` and `text-sm`; values wrap normally; a value longer than one line (a call note, the basis line) spans both columns on its own row with the label above it.
- **Block 1, "What the sources say"**: one row per cupper from the call rows: `<cupper name> (s<id>, blind|not blind)` → the call in bold, position call after a middot, the call note in `text-stone-500` on the next line; then Cuppers agree, Merged call, Roaster form proposal (with respondent and version), Roaster remark proposals, Website (up to three descriptor remarks from the latest capture), Latest session (link), Blind / roaster present.
- **Block 2, "What the catalog says"**: Archetype · confidence · source, Assigned from session, Basis (full width, in a quiet box, `text-sm`, line-height 1.5, with the `rule:` part on its own line in bold), Home slot · priority, Placement note, Band check, Dial signal basis, Newer evidence than decision, Roaster agrees with catalog, Flag (coloured chip).
- The same block layout is what the Coffees-page evidence panel (brief 3 B1) shows, so both get the fix.

## PART C: the decision cards
- Card title row: eyebrow + current value on one line (`text-sm`), e.g. **Archetype** · Earthy · low · cupping · s37.
- Form controls `text-sm`, selects full width in a two-column grid (Archetype | Confidence; Session | Source) with 12 px gap; labels above.
- **Basis preview**: a bordered box, `text-sm`, line-height 1.6, the composed part in normal weight, `rule: …` on its own last line in bold; the "A rule is required: the decision is not what every source said." sentence becomes an amber band above the rule input, not red text under the box. The Confirm / Change button sits right-aligned under the box; disabled state `opacity-50` with a one-line reason next to it ("type a rule").
- **Slot card**: each option is one row, `grid-template-columns: 1.5rem 12rem 1fr`: radio · `n · Name` (never wraps; `truncate` with title) · band and merged on one line (`band 6–9 · merged 6–7 · in band` with the check as a chip; `no band` greyed). Session | Priority as a two-column grid under the list; Place / Move and Certify on one row.
- **Descriptors card**: each roaster note is one row: checkbox · the roaster's words · `→ <node> (<family>)` or "unmapped · map"; the hit / miss / extra chip at the end. "Ours only" as a footnote in `text-xs`.

## PART D: Dimensions and Descriptors tabs
- Dimensions: the table gets the full pane width; cupper columns are built from the rows (one per cupper, header = cupper name), `tabular-nums`, min 56 px per numeric column; the merged column shows `6–11` with the session as a small link under it; rank column header "Rank (ours / theirs) of n" with a one-line key under the table: "rank among this roastery's coffees scored by both sides; a gap ≥ 2 flags". Flags as chips, not red text.
- Descriptors: family chips as today but `text-sm`; under them "Who named it" as a compact table (family · cuppers · roaster form · roaster website · customer) instead of prose; "Website, latest capture (<roaster>, <date>)" once as a sub-heading, then one line per note: `<roaster's words> → <node>` (unmapped greyed), no repeated source prefix.

## PART E: queue
- Each row two lines: name (`text-sm`, medium weight) with the two dots before it; second line `archetype · confidence · slot or "not placed" · n sources` in `text-xs text-stone-500`. Selected row has a left border in the accent colour. The three counters stay above the list with their dots as the legend.

## PART F: check
- Screenshots at 1366, 1440 and 1920 px window width, each of: the Archetype & slot tab for Joe Bean Blossom, the Dimensions tab, the Descriptors tab, and the three cards. Taken with Playwright against the local backend on the test DB as the Zzz Test admin, saved into this folder as `workbench_after_<width>.png`, attached to the closing report. The before image is `workbench_before_2026-10-21.jpg`.
- No text clipped, no overprint, no word-per-line wrap, nothing under 12 px, at any of the three widths.
- `npm run build` clean in frontend; the existing route and basis tests untouched and green; the six lints green (no backend file changes).
- One commit, straight to main. Closing report `CLOSING_REPORT_4b.md` with the screenshots and nothing else to decide.
