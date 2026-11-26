# Claude Code brief. Ella's Bloom Map 13: `/map` on a laptop, and the "More about this coffee" panel in the roaster's terms

Workstream: ella_bloom_map · Written 2026-11-26 by the CTO session · Builds on brief 12 (`CLOSING_REPORT_12.md`) · Model: the cheaper/faster model (G1.13) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (every heading, label and order is a row; no dimension name, brew method or roaster in code) · G2.4 CATALOG.md checked before any new table or view (none is expected) · G2.5 reads through existing views · G2.12 evidence is read as received; nothing the roaster sent is changed · G2.17 `comments.sql` then `catalog:md` only if the schema changes · G2.20 the roaster's portal answers are read, never edited · G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function and view this brief would add, beside the existing ones considered, and STOPS for Dana's yes · G4.1 reuse the shared panel; a prop or a variant, never a second component · G4.2 nothing typed in · G4.3 type-check; verify the page live at phone and laptop widths · G4.5 no roaster name, no award name · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 tests · G1.6 push is deploy, one closing report · G1.9 confirm no other session is running before you start and before you push.
Mode: test. STOP points: after Task 0; before the push.

**Goal.** Dana read `/map` on her laptop on 2026-11-26. The page is one phone-width column on every screen; the panel shows a bare "Espresso" tag; the notes come after the bars; and the bars are A&B's own cupping where she wants the roaster's ratings.

**Decisions already made (Dana, 2026-11-26; do not re-open).**

1. **A laptop layout for `/map`.** The phone layout stays as it is.
2. **The brew tag gets a heading**, in the words of the roaster's own portal question (expected: "Where it shines"), and lists every method the roaster named, their first choice first.
3. **Panel order:** the description, where it shines, the notes, then the bars.
4. **The bars on `/map` are the roaster's ratings**, not A&B's cupping. Shown where the roaster gave them; otherwise no bars. Never a mix of the two in one chart. The heading changes to match.
5. **`/map` only.** The Bloom page's panel and every `dial_surface` row stay exactly as they are.

CTO calls, reversible, flag if the code disagrees:

- **Laptop layout:** from the `lg` breakpoint, the map sits beside the top card, and the step cards run in two columns with the lead card across both. An open "More about this coffee" panel spans the full width under its row. Below `lg`, nothing changes.
- **The roaster's ratings** come from the portal answers already stored (`roastery_portal_response_dimension` through its existing view), converted to the bar scale by whatever conversion the portal comparison already uses. If a coffee's portal response is not accepted or has no dimensions, it has no bars.
- **A dimension that looks reversed is not shown.** Dana suspects one roaster reversed a scale. Task 0 compares each roaster's ratings with A&B's pooled cupping per dimension. Which roaster-and-dimension pairs are held back is data (a switch per pair, on `/admin/map` or the portal admin, wherever Task 0 finds the right home), never a list in code.
- **Headings are copy rows:** `where_it_shines` and `roaster_rates` ("How the roaster rates it") in `dial_customer_copy`.
- **"More about this coffee" shows when a coffee has a description, roaster bars, or notes with a where-it-shines answer.**

---

## Task 0: Verify (write into `CLOSING_REPORT_13.md`; STOP after)

Read-only, test DB and production.

1. **Reader, writer and view list (G3.9 amended).** Expected: no new table or view. Name the existing view and reader for the roaster's ratings and for the roaster's brew answers, and what the panel's hook from brief 12 would call.
2. **The roaster's ratings for the 18 map coffees:** per coffee, which dimensions the roaster rated, on what scale, and the converted value. Say which coffees have none.
3. **Scale check:** per roaster and dimension, the roaster's ratings beside A&B's pooled range across that roaster's coffees. Flag any dimension where the two run in opposite directions across the lineup, with the numbers. Propose where the hold-back switch lives.
4. **Where it shines:** the portal question's exact wording, how the answer is stored (one method or several, and their order), and what each of the 18 coffees would show. Compare with the single tag shown today.
5. **What each of the 18 panels would show** after this brief: description yes or no, where it shines, notes, bars yes or no. Name the coffees that would still have no "More about this coffee".
6. **The panel's dimension names:** the roaster's portal dimensions are not the same set as the cupping sheet's. List both and the labels a customer would see.

**STOP.** Show Dana items 2 to 6, and item 1 if anything new is proposed.

## Parts

**A. Data.** The two copy rows. The hold-back switch, as approved at the STOP.

**B. Backend.** The read the `/map` panel needs: the roaster's ratings and the where-it-shines list, through existing views and readers. The Bloom page's reads are untouched.

**C. Frontend.** The laptop layout in `MapPage.tsx`. The shared panel gets what it needs as props for its `/map` use: the section order, the two headings, the roaster's bars. Its Bloom-page use renders exactly as before.

**D. Tests.** The panel on `/map`: order of sections, the heading over the brew methods, roaster bars when present and none when absent, a held-back dimension not drawn. The Bloom page's panel unchanged (snapshot or its existing tests). No roaster name in any of it.

## Acceptance (local, signed in as admin, test DB)

- At 1440 px wide: map beside the top card, steps in two columns, lead across both. At 390 px wide: the page as it is today. Screenshots of both.
- Tiger Stripe's panel: description, "Where it shines" with the roaster's methods, notes, then "How the roaster rates it".
- A coffee with no A&B cupping but with portal ratings shows bars. A coffee with no portal ratings shows none.
- The Bloom page's "Reveal the full profile" looks and reads exactly as before.
- No roaster name, award name, comfort-zone label or compatibility sentence on `/map`.

## Docs and closing (G6)

`README.md` here; `WHAT_WE_BUILT.md`; `REGRESSION.md` (`/map` has a laptop layout from `lg`; its panel shows the roaster's ratings and never A&B's cupping; the Bloom page's panel is unchanged); `OPEN_TASKS.md` (coffees still without a panel; any held-back dimension, with its numbers); `CLOSING_REPORT_13.md`.

## Do not

- Do not change the Bloom page, its panel's output, the lane dial or any `dial_surface` row.
- Do not edit, convert in place or delete anything the roaster submitted.
- Do not mix roaster ratings and A&B cupping in one chart.
- Do not show a dimension flagged at the STOP until Dana says so.
- Do not build a second panel component.
- Do not add a reader, writer or view Dana did not approve at the Task 0 STOP.
- Do not push before the second STOP.
