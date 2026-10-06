# Feature: Roastery Portal, part 3 (roaster wording + the questions we were missing)

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-06 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-06 (commits 2aef02f + cd9be43 + docs on main, deploys green, acceptance verified live on the Zzz Test Roastery, cleaned up; see WHAT_WE_BUILT.md #212)
> Depends on: parts 1 and 2 (executed, `WHAT_WE_BUILT.md` #209 and #210).

## What this is

The form goes to real roasteries once. Before it does, two things change: the wording moves from our internal vocabulary to the words roasters use, and five questions are added that decide what we can sell, say, or print. Labels change; the dimensions, the stored values and the write/read paths from parts 1 and 2 do not.

## Decisions already made (Dana, 2026-10-06). Do not re-open.

1. **Rewording** (labels only, stored values unchanged):

   | Where | Now | Becomes |
   |---|---|---|
   | Section 04 question | "How is it best enjoyed?" | "Does it hold up in milk?" |
   | its options (`black` / `milk` / `both`) | Black · With milk · Both | Best black · Great with milk · Works both ways |
   | Section 04 legend | "Best brewing method" | "Where it shines" |
   | brew method `drip` | Drip | Batch brew / drip |
   | Section 05, `always_on` | Always on | Year-round (core) |
   | Section 05, `rotating` | Rotating | Seasonal |
   | Dimension Acidity | Acidity, Low / High | Acidity, Soft / Bright |
   | Dimension Savory / Depth | Clean to deep, Clean / Deep | Clarity, Clean / Layered |
   | Dimension Texture | Texture, Silky / Drying | Mouthfeel, Silky / Grippy |
   | Dimension Finish Length | Finish length, Short / Long | Finish, Short / Lingering |
   | Section 03 legend | "Most dominant dimension" | "What leads in the cup?" |
   | Section 02 label | "Your official tasting notes" | "Your bag notes" |

2. **New questions, per coffee, all optional:**
   - **Anything added.** "Is anything added to this coffee?" Yes / No, hint "fruit, spices, yeast cultures, flavoring, during processing or after roasting". When Yes, a text field "What is added".
   - **Roasted for.** Filter · Espresso · Both (omni). Single choice.
   - **Blend components and rotation.** Shown only when "Blend" is selected: a text field "Components" (hint "origins, rough shares if you share them") and "Does the recipe change during the year?" with Fixed recipe · Components rotate, profile stays · Changes with the season.
   - **Caffeine.** Replaces the Decaf yes/no: Regular · Half-caff · Decaf. When Decaf or Half-caff, "Decaf process": Swiss Water · Sugarcane (EA) · Mountain Water · CO2 · Other.
   - **Certifications.** Multi-select: USDA Organic · Fair Trade · Rainforest Alliance · Other · None. "None" is a real answer and clears the others; no selection means not answered.
3. **New question, once per lineup:** "Which of these do you sell most?" Pick up to three of their own active lineup coffees, in order.
4. **Not added** (considered and declined): rest and peak window, variety, Agtron number, bag sizes, grind options, prices, lead times.
5. The roaster's answer about additives is evidence for Dana. It never changes any label, ingredients text or customer surface by itself.

## Task 0: confirm before editing (report findings in the final report; STOP only if one contradicts this brief)

- Where each label in decision 1 lives today: `copy.ts`, `CoffeeScreen.tsx` literals, `lookup_value` rows, `roastery_portal_dimension` rows, and where the `takesIt` options come from.
- Whether the live `lookup_value` and `roastery_portal_dimension` labels still equal the seeded values (nobody edited them in prod).
- How the "sections answered (0 to 6)" count in `v_roastery_portal_progress` is computed.
- Whether part 2's accept does anything with `is_decaf` today, and which category codes exist for decaf and half-caff in `coffee_category`.
- Any drafts or submitted responses that exist in prod for real roasteries (count only). They must survive untouched.

## TASK

### A. Schema (`schema.sql`, idempotent, applies cleanly twice)

1. Label updates, each guarded on the OLD label so a value someone edited by hand is never overwritten (`UPDATE ... SET label = 'new' WHERE ... AND label = 'old'`). Change the seed `INSERT`s to the new labels as well, so a fresh database gets them.
2. `roastery_portal_response`: add nullable `additives_present BOOLEAN`, `additives_detail TEXT`, `roast_intent TEXT`, `blend_components TEXT`, `blend_rotation TEXT`, `caffeine_level TEXT`, `decaf_process TEXT`, `certifications TEXT[]`.
3. `is_decaf` on `roastery_portal_response` is deprecated: no new code writes it, the column stays. Submitted rows cannot be updated (part 1 trigger), so do not backfill them. `v_roastery_portal_current_response` exposes one `caffeine_level`: the new column when set, else `decaf` / `regular` derived from `is_decaf`. That view is the only definition. The lineup row's `is_decaf` prefill stays and prefills the new field the same way.
4. `roastery_portal_lineup_response_best_seller`: `lineup_response_id`, `portal_coffee_id`, `rank` (1 to 3). Unique (`lineup_response_id`, `rank`) and (`lineup_response_id`, `portal_coffee_id`). Covered by the same immutable-after-submit trigger pattern as the other child tables.
5. New `lookup_value` categories (ON CONFLICT DO NOTHING): `roastery_portal_roast_intent` (filter, espresso, omni → "Filter", "Espresso", "Both (omni)"), `roastery_portal_blend_rotation` (fixed, rotates_same_profile, seasonal → labels from decision 2), `roastery_portal_caffeine` (regular, half_caff, decaf), `roastery_portal_decaf_process` (swiss_water, sugarcane_ea, mountain_water, co2, other), `roastery_portal_certification` (usda_organic, fair_trade, rainforest_alliance, other, none), `roastery_portal_takes_it` (black, milk, both with the decision 1 labels) if those options are not already lookup-driven.
6. `v_roastery_portal_progress`: the new fields count toward their own section (01 for the per-coffee ones). Still 6 sections.

### B. Backend

1. `roasteryPortalService.ts`: `saveDraft` and the lineup draft accept the new fields. Validate every value against its lookup category; a best seller must be an active lineup coffee of the same roastery; at most three. Normalise on save: `decaf_process` is cleared when caffeine is Regular; `blend_components` and `blend_rotation` are cleared when the coffee is not a blend; `additives_detail` is cleared when `additives_present` is not true; selecting `none` in certifications removes the others. Text caps: 300 for `additives_detail` and `blend_components`.
2. `roasteryPortalReads.ts`: the vocabulary bundle carries the new option lists; reads return the new fields. Still views only.
3. Accept (part 2): caffeine becomes one more tickable basic item in the preview, "Category: Decaf" or "Category: Half-caff", applied through the existing catalog door using the existing category codes. If no half-caff code exists, half-caff is display only; do not create a category. Every other new answer is display only in the preview.

### C. Partner page

1. Apply decision 1. All sentence copy stays in `copy.ts`, new lines marked `NEW` for Camila; option labels come from the DB.
2. Section 01, in this order: Origin · Single origin or blend (then Components and "Does the recipe change during the year?" when Blend) · Caffeine (then Decaf process when Decaf or Half-caff) · Process · "Is anything added to this coffee?" (then "What is added" when Yes) · Roast level · Roasted for · Certifications.
3. Conditional fields appear and disappear without layout jumps on a phone; hiding one keeps nothing stale (the service normalises, the form mirrors it).
4. "About your lineup": add "Which of these do you sell most?" as tappable coffee chips showing the pick order (1, 2, 3), tap again to remove.
5. Same component shapes, palette and mobile rules as part 1. No new components beyond what the conditional fields need.

### D. Admin

1. The read-only response view shows the new answers in their section, and the lineup view shows the best sellers in order.
2. When `additives_present` is true, the coffee row and the accept preview carry a plain marker: "Contains added ingredients: <detail>. Check the ingredients statement on the bag." Display only.
3. A "Recipe changes" marker on blends answered `rotates_same_profile` or `seasonal`.

## CONSTRAINTS

- No change to stored values of existing fields, to the dimensions asked, or to any customer-facing surface.
- All writes through `roasteryPortalService.ts`; catalog writes only through `catalogService.ts`; both portal lints green, including the read lint.
- Existing drafts and submitted versions keep working and display correctly, old `is_decaf` answers included.
- Do not act as Dana or any real person. Use a marked `Zzz Test` admin, disabled at the end.
- No new environment variables.
- `npx tsc --noEmit` clean in backend, no new frontend errors, `vite build` clean, lints and boot integrity green, `schema.sql` applies twice on the test database. Add tests for: lookup validation of each new field, the four normalisation rules, best-seller roastery isolation and the three-pick cap, the caffeine fallback from `is_decaf` in the view, guarded label updates leaving a hand-edited label alone.

## DONE = commits pushed straight to `main`, deploy green, startup log clean, acceptance verified live, `WHAT_WE_BUILT.md` and `WHAT_WE_BUILT_DB.md` entries, Status above flipped. One report at the end.

## ACCEPTANCE (live production, Zzz Test Roastery only, 390 wide)

1. Every label in decision 1 shows its new wording on the partner page. List each one as seen.
2. Blend selected: Components and the rotation question appear. Switch to Single origin: they disappear and the saved draft holds neither.
3. Caffeine Decaf: Decaf process appears. Back to Regular: it disappears and is cleared.
4. Anything added Yes with "passion fruit": saved. Admin shows the marker with the detail on the row and in the accept preview.
5. Certifications: pick two, then None: only None remains.
6. Roasted for saved and shown in admin.
7. Lineup: pick three best sellers; the order is kept after refresh; a fourth pick is refused; a coffee id from another roastery returns 404.
8. A response submitted before this change (create one first, or use a part 2 leftover) still opens in admin and shows its caffeine from the old `is_decaf` answer.
9. Accept preview on a Decaf coffee offers "Category: Decaf" as a ticked item, and accepting applies it. State the coffee id.
10. Count of real-roastery drafts and submissions before and after: unchanged.

Cleanup as in part 2: retire the test coffee, empty its descriptors, deactivate test lineup rows, revoke the test link, disable the test admin, leave Zzz inactive. **Nothing accepted, changed or submitted for Utopian or any real roastery.**
