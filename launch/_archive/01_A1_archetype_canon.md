# Step 01 (A1) — Archetype taxonomy cleanup: 5 archetypes, Experimental is a category

> Order: 1 of 10 · Model: Sonnet · Depends on: nothing · One session, read the diff before deploy.
> Rewritten clean 2026-07-17 (v2) after a reverted first run — this version is the source of truth.

CONTEXT: Axis & Bloom repo. The quiz backend (V7) scores exactly **5 archetypes**: Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy — plus an `experimental` boolean flag returned by POST /api/quiz/score. The frontend has drifted from this in two distinct ways:

1. Some surfaces render **"Spicy & Earthy"** as if it were its own archetype. It is not — the backend scores it as Earthy, and ARCHETYPE_NAME_TO_KEY already maps "Spicy and Earthy" → earthy. This is a naming/mapping drift to fix.
2. Some surfaces present **"Experimental"** as a 6th archetype in lists and counts. Officially, Experimental is a **CATEGORY** that attaches to a matched archetype — but it legitimately has its own visual identity in the product (wallpaper, bag, result rendering), and all of that stays.

TASK — three parts, in this order:

**Part 1 — Audit first, change nothing yet.**
Find and list every frontend surface that renders archetype names, colors, wallpapers, bag imagery, archetype lists/pickers, or archetype counts: quiz results screen (FlavorQuiz.tsx, the CAMILAS #43 gift-reveal), /bloom, shop surfaces, archetype cards/sections, packaging/label templates, archetype constant files, and any copy that says "six archetypes" or equivalent. Present the list grouped into: (a) Spicy & Earthy appearances, (b) Experimental-in-a-taxonomy appearances (lists/counts/pickers), (c) Experimental visual/logic usages that must NOT change. Wait for nothing — proceed after listing, but the list must appear in your output.

**Part 2 — Merge Spicy & Earthy into Earthy.**
- Everywhere "Spicy & Earthy" (any spelling) appears as a displayed archetype, it becomes **Earthy**.
- Keep whichever wallpaper/bag/world assets are stronger (Spicy & Earthy's vs Earthy's existing ones) as Earthy's assets — this is a rename/merge, do NOT delete the visual world.
- ARCHETYPE_NAME_TO_KEY stays tolerant of legacy spellings ("Spicy and Earthy", "Spicy & Earthy", "earthy", etc.) but maps only into the 5 canon keys.

**Part 3 — Reclassify Experimental (classification only — nothing visual changes).**
- KEEP, untouched: Experimental's wallpaper, bag imagery, result-screen rendering when `experimental` is true, and every piece of logic keyed off the experimental flag. If a quiz run flagged experimental looked a certain way before this task, it must look **identical** after.
- CHANGE, only this: anywhere archetypes are enumerated, listed, picked, or counted as a taxonomy, Experimental is not among them — those surfaces show exactly the 5 canon archetypes. Any copy saying "six archetypes" (or six worlds/flavors in the archetype sense) becomes "five".

HARD BOUNDARIES (violating any of these means the task failed):
- Do NOT remove, restyle, or convert Experimental's visuals or logic to a badge or anything else.
- Do NOT touch backend scoring logic, quiz questions, archetype tables, or any API.
- Do NOT redesign or rebuild the results screen or ArchetypeSection — this is a mapping/classification cleanup.
- Do NOT modify the homepage: it contains lifecycle-aware personalization and the Company Gift redemption widget that past rebuilds silently dropped (standing warning at top of CAMILAS_UPDATES.md).

ACCEPTANCE — demonstrate each before finishing:
1. Quiz answers that previously produced "Spicy & Earthy" → result renders **Earthy** with its (merged) world.
2. A quiz run that trips the experimental gate renders **exactly as it did before this change** — same wallpaper, same bag, same experience.
3. No list, picker, count, or copy anywhere presents Experimental as a 6th archetype or says "six archetypes".
4. The Part 1 audit list is included in your output, with each item marked as changed / intentionally untouched.
