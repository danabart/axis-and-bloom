# Roastery Portal, part 7: load Joe Coffee Company's lineup

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-08 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-08. Roastery f42ad179-9ef4-410a-a92e-464eae1d84ce and eight lineup rows created and verified through the admin preview; see WHAT_WE_BUILT.md #217.
> Data task only. No code change, no schema change. Same shape as part 6 (Joe Bean Roasters).

## What this is

Axis & Bloom cupped eight coffees from Joe Coffee Company (New York, joecoffeecompany.com). Dana wants the same portal form Utopian and Joe Bean have, listing these eight, prefilled from Joe Coffee's public site (checked 2026-10-08).

**Joe Coffee Company is a different company from Joe Bean Roasters (part 6). Do not touch Joe Bean's roastery or lineup.**

## Decisions already made (Dana, 2026-10-08). Do not re-open.

1. The lineup is exactly the eight coffees below, in this order.
2. Prefills come only from what Joe Coffee's own site states. Where the site is silent, the field stays empty.
3. Dana creates the link herself. Do not create one.

## Task 0 (report; STOP only if one contradicts this brief)

- Whether a roastery for Joe Coffee already exists in `roaster` (any spelling: "Joe Coffee", "Joe Coffee Company", "Joe"). It must not be confused with `Joe Bean Roasters` (id 19098f5c-99b9-4d7c-90ef-ee33d1e896b7).
- If it exists: its id, whether it is active, and whether it already has portal lineup rows. If lineup rows already exist, STOP and report instead of adding duplicates. If it exists but is inactive, STOP and report; do not reactivate it.
- The current lookup values for `roast_level`, `process` and `blend_or_single`.
- Whether `roastery_portal_coffee.is_decaf` accepts NULL.

## TASK

1. If no Joe Coffee roastery exists, create it through the existing admin roastery route: name `Joe Coffee Company`, website `https://joecoffeecompany.com`, active. No other fields.
2. Add the eight lineup coffees through the portal's admin API or `roasteryPortalService` (not SQL), `added_by = 'admin'`, `prefill_source = 'roaster_site'` on all eight, in this order:

| # | Name | Single or blend | Origin prefill | Process prefill | Roast prefill | Decaf |
|---|---|---|---|---|---|---|
| 1 | Cafè Feminista: Montze Olvera | single | Sierra de Tenango, Hidalgo, Mexico (Montze Olvera) | honey | light | (empty) |
| 2 | Colombia La Familia Guarnizo | single | Huila, Colombia (The Guarnizo Family) | washed | light | (empty) |
| 3 | The Village | single | Ngozi, Burundi (Turihamwe Women's Group) | washed | light | (empty) |
| 4 | Benchmark | blend | San Ignacio, Cajamarca, Peru | washed | medium | (empty) |
| 5 | Amsterdam | blend | Cerrado, Minas Gerais, Brazil | natural | medium | (empty) |
| 6 | The Daily | blend | Chiapas, Mexico and Huila, Colombia | washed | medium | (empty) |
| 7 | Big City | blend | Cerrado, Minas Gerais, Brazil and Nicaragua | natural, washed | dark | (empty) |
| 8 | Nightcap Decaf | single | Tapachula, Chiapas, Mexico (Muguira Family) | washed | medium | yes |

   - Use the exact lookup values found in Task 0. Big City has two process values.
   - Decaf: set `is_decaf = true` on Nightcap Decaf only. On the other seven leave it NULL, because the site does not state it and a prefilled "no" would carry the "from your site" tag. If the column does not accept NULL, use false for those seven and say so in the report.
   - No lineup coffee is linked to a catalog coffee.
3. Verify through the admin preview endpoint (part 5): Joe Coffee's form shows eight coffees in this order, all "Not started", with the prefills above, and the "from your site" tag only on fields that have a value.

## CONSTRAINTS

- Do not act as Dana or any real person. Use a marked `Zzz Test` admin for the API calls, demoted and disabled at the end.
- No link, no respondent, no response for Joe Coffee. No change to Utopian, Joe Bean Roasters or any other roastery.
- No catalog write: no coffee is created in `coffees`.
- Nothing committed except this brief's status line and one short `WHAT_WE_BUILT.md` entry.

## DONE = the eight rows exist and verify as above; one report listing the roastery id, the eight lineup ids, and the admin URL where Dana opens the preview and creates the link.
