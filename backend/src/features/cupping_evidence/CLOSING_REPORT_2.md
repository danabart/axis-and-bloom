# Closing report: Cupping evidence, brief 2 (loads)

2026-10-18 · Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md` · `WHAT_WE_BUILT.md` #225

## Commits and deploy
- `95aa0fe`: Part 0 + loader + manifests (+ A3b slot-price step). Deployed by GitHub Actions run 39135999198 as `axis-bloom-backend-00758-9zk` (100% traffic).
- Docs commit (this report, `WHAT_WE_BUILT*.md`, `SOMMELIER_BUILT.md` S112, regenerated `CATALOG.md`, brief status line): the commit right after `95aa0fe` on `main`.

## Order of work
1. Task 0 (read-only) → STOP on the missing `Utopian Coffee Co.` roaster → Dana's rulings 1 to 8.
2. Part 0 on the test DB (schema applied twice; seed proven in a rolled-back transaction).
3. Loader on test, twice (second run: everything `already loaded`). Stopped for Dana.
4. Dana's go + A3b. A3b proven on test (set 3, then left alone 3).
5. Test DB refreshed from prod; full suite 732 pass / 6 OT-19 fail; six lints and build green; commit, push, deploy.
6. Loader on prod, then again (writes nothing). `runCatalogIntegrityChecks().allPass = true` on prod.

## Coffee ids (prod)
| Roaster | Coffee | id |
|---|---|---|
| Joe Coffee Company | Cafè Feminista: Montze Olvera | 2902 |
| | Colombia La Familia Guarnizo | 2903 |
| | The Village | 2904 |
| | Benchmark | 2905 |
| | Amsterdam | 2906 |
| | The Daily | 2907 |
| | Big City | 2908 |
| | Nightcap Decaf (`decaf`) | 2909 |
| Joe Bean Roasters | Tiger Stripe Espresso | 2914 |
| | Geometric Filter Coffee | 2915 |
| | Blossom Dark Roast | 2916 |
| | Fabricator House Roast | 2917 |
| Utopian | Espresso Volo | 2927 |
| | Peru Chirinos Geisha | 2928 |
| | Obsidian | 2929 |
| | Decaf Mexico Veracruz (`decaf`) | 2930 |
| | Peru Joel Silva Chirinos | 2931 |
| | Mexico Alva Flores | 2932 |
| | Pearl | 2933 |
| | Union | 2934 |
| | Colombia Andres Martinez | 2935 |
| | Flying Jewel (existing) | 2891 |

## Session ids (prod)
| Session | What | Date | Sheet | Blind | Roaster present | Samples / brew rows |
|---|---|---|---|---|---|---|
| 35 | Utopian flight C (updated, not duplicated) | 2026-09-20 estimated | ab_0_15_8dim | no | no | 3 / 3 |
| 36 | Joe Coffee B1 | 2026-10-02 | ab_0_15_8dim | no | yes | 8 / 8 |
| 37 | Joe Bean C1 | 2026-09-30 | ab_0_15_8dim | yes | no | 4 / 4 |
| 38 | Utopian flight A | 2026-09-13 | freeform_grid | no | no | 4 / 4 |
| 39 | Utopian flight B | 2026-09-20 estimated | freeform_grid | no | no | 3 / 3 |

## Score ids and merge notes per session coffee (prod)
| s | sc | Coffee | Cupper rows | Merged | merge_note |
|---|---|---|---|---|---|
| 35 | 42 | Flying Jewel | Dana 119, Camila 120 (supersedes legacy 69) | 121 | union_v1; scales: Camila ab_0_15, Dana ab_0_15; cupper disagreement (gap > 2) on: Bitterness; one cupper: Fragrance, Aroma |
| 35 | 62 | Union | Dana 122, Camila 123 | 124 | union_v1; …; disagreement on: Sweetness, Body; one cupper: Fragrance, Aroma, Finish Length |
| 35 | 63 | Pearl | Dana 125, Camila 126 | 127 | union_v1; …; disagreement on: Sweetness, Body; one cupper: Fragrance, Aroma, Finish Length |
| 36 | 43 | Feminista | Dana 70 | 71 | union_v1; scales: Dana ab_0_15; one cupper: Sweetness, Acidity, Bitterness, Body |
| 36 | 44 | La Familia | Dana 72 | 73 | …; one cupper: Sweetness, Acidity, Bitterness |
| 36 | 45 | The Village | Dana 74 | 75 | …; one cupper: Sweetness, Acidity, Bitterness, Body |
| 36 | 46 | Benchmark | Dana 76 | 77 | …; one cupper: Sweetness, Acidity, Bitterness |
| 36 | 47 | Amsterdam | Dana 78 | 79 | …; one cupper: Sweetness, Acidity, Bitterness, Body |
| 36 | 48 | The Daily | Dana 80 | 81 | …; one cupper: Sweetness, Acidity, Bitterness |
| 36 | 49 | Big City | Dana 82 | 83 | …; one cupper: Sweetness, Acidity, Bitterness, Body |
| 36 | 50 | Nightcap Decaf | Dana 84 | 85 | …; one cupper: Sweetness, Acidity, Bitterness, Body, Finish Length |
| 37 | 51 | Tiger Stripe | Dana 86, Camila 87 | 88 | …; disagreement on: Aroma; one cupper: Flavor, Finish Length |
| 37 | 52 | Geometric | Dana 89, Camila 90 | 91 | …; disagreement on: Aroma, Sweetness, Acidity; one cupper: Flavor, Finish Length |
| 37 | 53 | Blossom | Dana 92, Camila 93 | 94 | …; disagreement on: Fragrance, Aroma, Sweetness; one cupper: Flavor, Finish Length |
| 37 | 54 | Fabricator | Dana 95, Camila 96 | 97 | …; disagreement on: Sweetness; one cupper: Flavor, Finish Length |
| 38 | 55 | Alva Flores | Dana 98, Camila 99 (grid_0_5) | 100 | …; disagreement on: Sweetness, Bitterness; no dial signal (converted scale) |
| 38 | 56 | Chirinos Geisha | Dana 101, Camila 102 (grid_0_5) | 103 | …; disagreement on: Sweetness; no dial signal (converted scale) |
| 38 | 57 | Andres Martinez | Dana 104, Camila 105 (grid_0_5) | 106 | …; disagreement on: Sweetness, Acidity; no dial signal (converted scale) |
| 38 | 58 | Joel Silva Chirinos | Dana 107, Camila 108 (grid_0_5) | 109 | …; disagreement on: Acidity; no dial signal (converted scale) |
| 39 | 59 | Espresso Volo | Dana 110, Camila 111 (word_3) | 112 | union_v1; scales: Camila word_3, Dana ab_0_15; no dial signal (converted scale) |
| 39 | 60 | Obsidian | Dana 113, Camila 114 (word_3) | 115 | same |
| 39 | 61 | Decaf Veracruz | Dana 116, Camila 117 (word_3) | 118 | same |

Disagreement lists match the corrected brief. Merged archetype calls follow the design rule (Dana's ruling, 2026-10-18: a missing call does not veto): Tiger chocolate_nutty, Blossom earthy, Fabricator fruity, Chirinos floral, Joel Silva fruity, Pearl fruity, Volo and Obsidian earthy; Joe Coffee's one-cupper calls are Dana's.

## Counts (prod = test, exactly)
- Sessions 4 created + 1 updated; session coffees 21 created + 1 brew row added (sample 42); 36 cupper rows (29 `ab_0_15`, 4 `grid_0_5`, 3 `word_3`); 22 merges.
- Descriptor rows on current rows (total / on merged): s35 48/23, s36 46/23, s37 66/31, s38 56/25, s39 56/25.
- Remarks: Joe Coffee cupping_table 38 (1 with a node), Joe Coffee website 84 (41), Joe Bean website 49 (29), Utopian website 52 (24).
- Mappings: cupper 31, roaster 67 (all `note LIKE 'loader %'`; brief expected 16, the D6 to D8 tables name more words). D6 has 22 distinct words (brief: 20); D7 84 rows as computed; D8 49 rows (brief: about 51: 12 description rows not 11, 2 origin rows not 3, plus 1 roastery-level brewing row).
- Coffees created 21; lineup links 21 + 1 existing (Utopian 10/10, Joe Coffee 8/11, Joe Bean 4/7).
- Slot prices 3 set (A3b).

## Dial signals
13 written, basis `archetype_vector (May 2026 targets)` (no slot carries spec bands): Amsterdam, Benchmark, Big City, Blossom, Feminista, Fabricator, Flying Jewel, Geometric, Nightcap Decaf, Pearl, The Village, Tiger Stripe, Union.
No signal, with the reason:
| Coffee | Reason |
|---|---|
| Colombia La Familia Guarnizo | floral's dominant dimension is Savory / Depth; no sheet scores it |
| Peru Chirinos Geisha | same (floral → Depth), and flight A is a converted scale |
| The Daily | chocolate_nutty runs on Body; Dana's sheet has no Body value for it |
| Mexico Alva Flores, Colombia Andres Martinez, Peru Joel Silva Chirinos | Camila's `grid_0_5` row: not every row is `ab_0_15` |
| Espresso Volo, Obsidian, Decaf Mexico Veracruz | Camila's `word_3` row: same |

Nightcap Decaf does get a signal (Acidity 6–8 → `fruity` slot 7): decaf does not block it.

## balanced_sweet/2, before and after
- Before: no holder; only a 5 lb ($185) slot price.
- After: Benchmark (2905) home, priority 1, certified; 12 oz price $29 added. No other coffee moved.

## A3b and v_coffee_sellable_slot (prod)
None of the three slots had a 12 oz price, so nothing was left alone.
| coffee_id | coffee | slot | 12 oz | role | priority |
|---|---|---|---|---|---|
| 2905 | Benchmark | 4 balanced_sweet/2 "Classic Balanced" | 2900 | home | 1 |
| 2902 | Cafè Feminista: Montze Olvera | 7 fruity/1 "Clean Fruit" | 2900 | home | 1 |
| 2903 | Colombia La Familia Guarnizo | 11 floral/1 "Light Floral Edge" | 2900 | home | 1 |

The Village (2904) is on `fruity/1` at priority 2 behind Feminista; the view returns one winner per slot and size, so it does not appear (the brief's DONE line expected four rows).

## Leaf names missing or respelled
None. Every leaf the tables name exists by exact descriptor and is active. Of the brief's candidates, Pepper, Sweet Aromatics, Tobacco, Vanilla, Black Tea and Brown Sugar are childless tier-2 nodes, not leaves (used at tier 2, which is what the cupper named); Malic Acid exists. The tier-2 Green / Vegetative node was created in Part 0.3.

## Import warnings
`band_no_spec` on the four placed Joe Coffee coffees (the slots have no spec bands yet). No other warning; every manifest's integrity was `allPass`.

## Flying Jewel finding
Session 35 / sample 42 / score 69 was Camila's flight C row, hand-entered in Score Entry before the 2026-09-27 placement and tagged `legacy` by brief 1. The loader reused session 35 as flight C (header updated to 2026-09-20 estimated, `ab_0_15_8dim`), added the missing brew row, wrote Dana's row (119) and Camila's as the paper reads it (120, superseding 69 with a reason), and merged (121). Coffee 2891's assignment and placement (fruity/4, priority 1) are unchanged. Its signal now rests on the merged Acidity 2–5.

## Deviations and findings
1. **Load order:** manifests run after the session headers and before the samples (a session coffee needs its coffee row); decision 16 was corrected to match.
2. **Importer:** `match.notes` and `match.sessionId` added so the basis lines go through the importer; it also refreshes the signal on create.
3. **`saveBrewParams`:** a first brew row on a scored sample is allowed (sample 42); a second is still refused.
4. **Loader file name:** `load/loadCuppingEvidence2.ts` (the CONSTRAINTS line says `load_cupping_evidence_2.ts`); the npm script is `load:cupping-evidence-2`.
5. **comments.sql / CATALOG.md:** the brief said no change; one was needed: brief 1 had dropped `; seed` from `cupping_score_values`' Writer, which the rewritten seed needs (`lint:lineage`). `CATALOG.md` regenerated from prod.
6. **Website URLs** for Joe Coffee and Joe Bean remarks were formed as `joecoffeecompany.com/products/<slug>` and `shop.joebeanroasters.com/products/<slug>` from the slugs in D7/D8: inferred, not captured.
7. **Test fixtures vs real placements:** after the test load, 9 tests failed (catalog_blueprint ×2, catalogImport ×4, coffees hops ×1, sommelierRag ×2) because they assume `fruity/1`, `floral/1` and `balanced_sweet/2` are empty. The test DB was refreshed from prod before the commit run (green). Prod now holds these placements, so **the next `test:db:refresh` brings the 9 failures back** until those fixtures choose free slots. Needs its own small fix.
8. **`schema.sql` cannot build an empty database** (line ~438 references `coffees` before its CREATE). Logged for its own brief, per Dana.
9. **Refreshing the test DB** removed the test-run rows and the brief 1 Zzz fixtures; brief 3's tests will need the loader run on test again (`npm run load:cupping-evidence-2 -- --target test`), which leaves the 9 fixtures above failing until item 7 is fixed.

## Admin URLs
- Coffees page: https://www.axisandbloomcoffee.com/admin/coffees
- Roastery Feedback (Joe Coffee, Joe Bean, Utopian): https://www.axisandbloomcoffee.com/admin/roastery-portal
