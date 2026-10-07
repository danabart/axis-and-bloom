# Roastery Portal, part 6: load Joe Bean Roasters' lineup

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-07 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-07. Roastery 19098f5c-99b9-4d7c-90ef-ee33d1e896b7 and seven lineup rows created and verified through the admin preview; see WHAT_WE_BUILT.md #216.
> Data task only. No code change, no schema change, no deploy.

## What this is

Joe Bean Roasters (Rochester NY, shop.joebeanroasters.com) roasted seven coffees for Axis & Bloom and sent them in unlabeled bags: four blends and three single origins. Dana wants the same portal form Utopian has, with these seven coffees listed and prefilled from Joe Bean's public site where the site says something.

## Decisions already made (Dana, 2026-10-07). Do not re-open.

1. The lineup is exactly the seven coffees below, in this order.
2. Prefills come only from what Joe Bean's own site states (checked 2026-10-07). Where the site is silent, the field stays empty. Nothing is guessed.
3. Dana creates the link herself. Do not create one.

## Task 0 (report; STOP only if one contradicts this brief)

- Whether a roastery for Joe Bean already exists in `roaster` (any spelling: "Joe Bean", "Joe Bean Roasters", "Tailor Fit"). Do NOT confuse it with "Joe Coffee" / "Joe Coffee Company", which is a different company.
- If it exists: its id, whether it is active, and whether it already has portal lineup rows. If lineup rows already exist, STOP and report instead of adding duplicates.
- The current lookup values for `roast_level`, `process` and `blend_or_single`.

## TASK

1. If no Joe Bean roastery exists, create it through the existing admin roastery route (the same path the Roasteries admin page uses): name `Joe Bean Roasters`, website `https://shop.joebeanroasters.com`, active. No other fields. If one exists but is inactive, STOP and report; do not reactivate it.
2. Add the seven lineup coffees through the portal's admin API or `roasteryPortalService` (not SQL), `added_by = 'admin'`, in this order:

| # | Name | Single or blend | Origin prefill | Process prefill | Roast prefill | Decaf | prefill_source |
|---|---|---|---|---|---|---|---|
| 1 | Blossom Dark Roast | blend | (empty) | (empty) | dark | no | roaster_site |
| 2 | Tiger Stripe Espresso | blend | (empty) | (empty) | (empty) | no | roaster_site |
| 3 | Fabricator House Roast | blend | Colombia and Brazil (Mogiana) | (empty) | (empty) | no | roaster_site |
| 4 | Geometric Filter Coffee | blend | (empty) | (empty) | (empty) | no | roaster_site |
| 5 | Brazil | single | (empty) | (empty) | (empty) | no | (null) |
| 6 | Indonesia | single | (empty) | (empty) | (empty) | no | (null) |
| 7 | D.R. Congo | single | South Kivu, D.R. Congo (Muungano Cooperative) | natural | (empty) | no | roaster_site |

   Use the exact lookup values found in Task 0 (for example `dark`, `natural`, `blend`, `single`). No lineup coffee is linked to a catalog coffee.
3. Verify through the admin preview endpoint (part 5): Joe Bean's form shows seven coffees in this order, all "Not started", with the prefills above and the "from your site" tag only on the fields that have a value.

## CONSTRAINTS

- Do not act as Dana or any real person. Use a marked `Zzz Test` admin for the API calls, demoted and disabled at the end.
- No link, no respondent, no response for Joe Bean. No change to Utopian or any other roastery.
- No catalog write: no coffee is created in `coffees`.
- Nothing committed except this brief's status line and one short `WHAT_WE_BUILT.md` entry.

## DONE = the seven rows exist and verify as above; one report listing the roastery id, the seven lineup ids, and the admin URL where Dana opens the preview and creates the link.
