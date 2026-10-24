# Coffee presentation, brief 2: closing report

> Brief: `CLAUDE_CODE_PROMPT_COFFEE_PRESENTATION_2.md` · Run 2026-10-24 on the **test DB** (`axisandbloom_test`) · `WHAT_WE_BUILT.md` #233, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md` S114
> **Status: done on prod 2026-10-24** (commit `0f12129`, revision `axis-bloom-backend-00773-r54`; prod results at the end).

## Where the data differs from the brief

1. **"Today every archetype has 1 or 2 active cupped coffees": not so on test.** By decision 2's own definition (active coffees, current match, a pooled midpoint), `v_archetype_dimension_profile` on test holds:

   | reader archetype | coffees in profile | coffee of the same archetype (leave-one-out) | coffee of another archetype | sentences over 22 active coffees |
   |---|---|---|---|---|
   | chocolate_nutty | 4 (2917 moved in) | 3: badge alone | 4: sentence | 18 of 22 |
   | balanced_sweet | 4 | 3: badge alone | 4: sentence | 18 of 22 |
   | earthy | 4 | 3: badge alone | 4: sentence | 18 of 22 |
   | fruity | 9 | 8: sentence | 9: sentence | 22 of 22 |
   | floral | 2 | 1: badge alone | 2: badge alone | 0 of 22 |

   (`compareCoffee` over every active coffee × reader archetype on test: 76 of 110 pairs render.) So on the C&N dial a C&N customer sees the badge alone, as you wanted, but a C&N customer looking at a Fruity or Earthy coffee, and every Fruity customer, still gets a sentence, now against real coffees. Test mirrors prod's 22 active coffees, so prod is likely the same; I have not read prod. `archetype_profile_min_coffees` is editable on the Evidence parameters card if you want none at all yet.
2. **`archetype_vector` still has a customer-facing reader besides the sentence.** `GET /api/coffees/archetype-order` (the Bloom page's archetype box order for a matched customer) sorts by Euclidean distance over `v_archetype_vectors.ideal_score`. Not touched (outside the brief). The catalog comment says so instead of "no customer-facing reader", and lists it next to `dialSuggestion.getDialSuggestion` as open.
3. **Fabricator's roaster form proposes Balanced, not Fruity.** The dry run's basis reads `roaster form v1 (Kathy Turiano)=balanced_sweet`. Fruity is the previous assignment (s37: Dana "fruity light"). Your note ("roaster classification Fruity kept as evidence") is stored word for word as the note and as the basis rule. Say if you want it changed before prod.
4. **Session 2026-10-21 is s40**, and neither cupper made an archetype call there (`Dana=no call, Camila=no call`), so `ruleRequired` is true and your note is the rule.
5. **No C&N coffee is placed on test**, so there is no C&N reveal panel to shoot here and `/api/coffees/2917/story` returns `dialPosition: null` on test (2917 has no home slot on test). The C&N screenshot and the non-null `dialPosition` are prod checks after the deploy. The test screenshot is the Balanced reveal panel (2905).
6. **B1 wording.** "Keep the Liam-intake block" conflicts with decision 6: the "Liam's intake" block *is* `ai_summary`. I removed it (decision 6 and the test "renders no summary markup") and kept the actions row.

## What changed

**Part 0, parameters** (seeded beside brief 1's rows, same guard):
- `archetype_profile_min_coffees` 4 (`Range: integer 1 <= value <= 20.`), `dimension_delta_slight` 1.5 and `dimension_delta_significant` 4 (`Range: numeric 0 < value <= 15.`).
- `evidenceParameterService` checks slight < significant against the other key's current value (an `ORDERED_PAIRS` list, no number).
- Its range regex now accepts the word `numeric` (it only knew `integer`). Without that, the brief's note text would not parse and the two keys would show on the card but not be editable.

**Part A, the sentence.**
- A1 `v_archetype_dimension_profile` (after `v_archetype_dimension_comparison` in `schema.sql`).
- A2 `services/compatibilityReads.ts`.
  - **Leave-one-out:** recomputed from the view's `coffee_ids` against `v_coffee_dimension_range` in one query, not a second view column pair. That was simpler, and the average without the coffee is exact rather than back-derived from a rounded mean.
  - **Wording and inputs:** the three sentence shapes are the old function's, word for word. The coffee's midpoints are taken as the page took them (each end rounded to one decimal). Thresholds come from `param()`, the label from `getArchetypes`.
  - **`no_reference`:** returned for an unknown archetype, an archetype with no cupped coffee, or a coffee with no numeric range on a reference dimension. The old function said "sits close" when nothing overlapped.
  - **One edge fixed:** the old code named delta exactly +1.5 "slightly less"; it is "slightly more" now.
- A3 `GET /api/coffees/:id/compatibility?userArchetype=<code>`.
- A4 `useCompatibility(coffeeArchetype, userArchetype, coffeeId)` fetches the sentence:
  - `RevealedPanel` gets a `coffeeId` prop (fetched once revealed).
  - The compare overlay passes `null` (badge only).
  - `archetypeVectors.ts` and `/api/axis/vectors` are deleted; grep found no other importer (the Axis page is static).
- A5 `comments.sql` (lines below).

**Part B, one description.**
- B1 `TastingNotes`: the story alone under "In the roaster's words", in both variants, with no legend.
- B2 the teaser is `teaserFor(wheelRows)`, the signature line.
- B3 generation:
  - `generateAndStoreAllContent` handles `three_voice_story` and `story` only; its return is `{ threeVoiceStory, story, storyPublished }`, and no caller reads the old keys.
  - The backfill candidates (`contentBackfillCandidates`) skip a coffee with a description and a story.
  - `refresh-summary` is now the same force refresh and returns `{ summary: threeVoiceStory }`; `generateAndStoreSummary` is removed.
  - `GET /:id/content` keeps `aiSummary` / `surpriseNote` with a comment.
- B4 Liam's RAG reads `three_voice_story`; the "What's unexpected" line is gone.
- B5 the admin block shows the one text.
- `getCoffeeSummary` / `getCoffeeSurpriseNote` stay in `claude.ts` with no caller; brief 1's prompt-snapshot test still covers them.

**Part C, Fabricator.**
- `load/setMatch2917.ts` exports `planMatch` / `runMatch` (the test drives them) and `main` (the CLI).
- The session is found by date through `cuppingReads.listSessions` (`lint:cupping`).
- The basis comes from `composeBasis` over `evidenceReads.getBasisRows`, a new read: the archetype card's rows on any runner, so the loader test runs inside a rolled-back transaction. It is finalized with your note as the rule.
- The write is `setMatchArchetype(input, { actor: 'coffee presentation brief 2' })`, then `generateAndStoreAllContent(2917, { force: true })`, then the line is printed and asserted along with `/story`'s `dialPosition`.

**Test DB writes this run:**
- The boot applied `schema.sql` and `comments.sql`.
- 2917's match is now `chocolate_nutty` (assignment 1785; 1210 kept with `superseded_at`).
- 2917's `three_voice_story` and story were regenerated (2 Claude calls, $0.0036).
- Nothing else was written outside rolled-back test transactions. The one committed test fixture (refresh-content) was removed by its own test.

## Before / after on test: 2914, 2917, 2905, 2934

Reader archetype: the dial you reviewed: C&N for 2914 and 2917, Balanced for 2905 and 2934. "Before" is the old frontend sentence recomputed from `v_archetype_vectors` (verbatim logic), the old teaser rule and every text the page stacked; "after" is `compareCoffee`, `teaserFor` and the one description. Raw output: `backend/tmp/cp2_before.txt`, `backend/tmp/cp2_after.txt` (not committed). 2914's stored `ai_summary` on test reads "at its heart, with and we tasted it too", a broken sentence; it is no longer shown anywhere.

### 2914

Before: match chocolate_nutty (low, s37) · reader chocolate_nutty. After: match chocolate_nutty (low, s37) · reader chocolate_nutty.

| | before | after |
|---|---|---|
| sentence | This coffee has significantly less bitterness and significantly less sweetness than your usual Chocolate & Nutty profile. | (none: below_min_coffees, 3 reference coffees) |
| teaser | An award-winning blend built on almond, chocolate, and peanuts that reveals a hint of cherry and apple underneath, defying the expectation that nutty roasts are straightforward and one-dimensional. | Almond, Chocolate, Peanuts |
| line | Almond, Chocolate, Peanuts / a hint of fruity: cherry, apple, dried fruit | Almond, Chocolate, Peanuts / a hint of fruity: cherry, apple, dried fruit |
| text shown | surprise note: An award-winning blend built on almond, chocolate, and peanuts that reveals a hint of cherry and apple underneath, defying the expectation that nutty roasts are straightforward and one-dimensional. / three voices: The roaster calls it almond and chocolate with peanuts at its core, and we tasted all three too. A hint of cherry and apple adds brightness beneath the main flavors. The roaster recommends it black or with steamed milk, and it holds a long finish. This award-winning blend has a moderate body and gentle sweetness, making it approachable on its own or creamy with milk. / Liam's intake (ai_summary): The roaster calls this award-winning blend almond, chocolate, and peanuts at its heart, with and we tasted it too. You'll find a hint of cherry, apple, and dried fruit threading through. It's an approachable cup with moderate body and a lingering finish, best enjoyed black or with steamed milk. Per the roaster, dial in around 18g for a 40-45g yield in 35-40 seconds. | In the roaster's words: The roaster calls it almond and chocolate with peanuts at its core, and we tasted all three too. A hint of cherry and apple adds brightness beneath the main flavors. The roaster recommends it black or with steamed milk, and it holds a long finish. This award-winning blend has a moderate body and gentle sweetness, making it approachable on its own or creamy with milk. |

### 2917

Before: match fruity (low, s37) · reader chocolate_nutty. After: match chocolate_nutty (medium, s40) · reader chocolate_nutty.

| | before | after |
|---|---|---|
| sentence | This coffee has significantly less body and significantly less bitterness than your usual Chocolate & Nutty profile. | (none: below_min_coffees, 3 reference coffees) |
| teaser | Citrus fruit takes center stage in this medium roast blend, yet it drinks beautifully with milk or black and handles everything from drip to espresso without losing its brightness. | Hazelnut |
| line | Citrus Fruit / a hint of nutty / cocoa: hazelnut; a hint of spices: cinnamon | Hazelnut / a hint of fruity: citrus fruit; a hint of spices: cinnamon |
| text shown | surprise note: Citrus fruit takes center stage in this medium roast blend, yet it drinks beautifully with milk or black and handles everything from drip to espresso without losing its brightness. The roaster's naturally processed element adds a hazelnut sweetness that shouldn't work with citrus, but does. / three voices: The roaster calls this blend citrus fruit forward with a hint of hazelnut and cinnamon, and we tasted the citrus fruit and hazelnut too. Beautifully balanced across a moderate body with gentle acidity, it brews well multiple ways. The roaster recommends it black or with milk, and the finish lingers pleasantly through the cup. / Liam's intake (ai_summary): Bright citrus fruit takes the lead in this medium roast blend, anchored by a naturally processed element that brings balance and versatility. A hint of hazelnut and cinnamon rounds out the cup, which the roaster calls beautifully balanced and recommends enjoyed black or with milk. Moderate body and acidity make it equally at home in an auto drip, pour over, or espresso. | In the roaster's words: The roaster calls this blend hazelnut-forward with a hint of citrus fruit and cinnamon, and we tasted the hazelnut and citrus fruit too. Per the roaster, it's beautifully balanced with moderate body and sweetness, a composed acidity, and a measured finish. The roaster recommends it with milk or black, and notes it brews well across methods from auto drip to pour over to espresso. |

### 2905

Before: match balanced_sweet (high, s36) · reader balanced_sweet. After: match balanced_sweet (high, s36) · reader balanced_sweet.

| | before | after |
|---|---|---|
| sentence | This coffee has significantly less acidity and slightly less body than your usual Balanced profile. | (none: below_min_coffees, 3 reference coffees) |
| teaser | This blend trades the expected heaviness of cocoa and caramel for a remarkably light, clean body that feels almost delicate, yet the roaster designed it specifically to hold its own with milk or black, refusing to disappear either way. | Caramelized, Cocoa |
| line | Caramelized, Cocoa / a hint of spices: brown spice | Caramelized, Cocoa / a hint of spices: brown spice |
| text shown | surprise note: This blend trades the expected heaviness of cocoa and caramel for a remarkably light, clean body that feels almost delicate, yet the roaster designed it specifically to hold its own with milk or black, refusing to disappear either way. / three voices: The roaster calls this blend caramelized and cocoa at its heart, with a hint of brown spice, and we tasted the caramel and cocoa too. It's smooth and balanced, designed to work equally well black or with milk. The cup has moderate sweetness and body, with minimal acidity and bitterness, making it forgiving and approachable whether you brew it as drip or espresso. / Liam's intake (ai_summary): The roaster describes this blend as smooth, balanced, and robust, with caramelized and cocoa as its core flavors, and we tasted those notes too. A hint of brown spice rounds out the cup. The roaster designed it to shine both on its own and with milk, with a moderate body, gentle sweetness, and minimal acidity that lets the caramel and cocoa linger softly. Medium-roasted and washed, it's equally at home in drip coffee or espresso. | In the roaster's words: The roaster calls this blend caramelized and cocoa at its heart, with a hint of brown spice, and we tasted the caramel and cocoa too. It's smooth and balanced, designed to work equally well black or with milk. The cup has moderate sweetness and body, with minimal acidity and bitterness, making it forgiving and approachable whether you brew it as drip or espresso. |

### 2934

Before: match balanced_sweet (low, s35) · reader balanced_sweet. After: match balanced_sweet (low, s35) · reader balanced_sweet.

| | before | after |
|---|---|---|
| sentence | This coffee has significantly less finish length and slightly less sweetness than your usual Balanced profile. | (none: below_min_coffees, 3 reference coffees) |
| teaser | A blend built on caramelized and nutty notes typically settles into comfort, yet this one keeps you reaching for another sip with its restless fragrance and surprisingly crisp finish that refuses to linger. | Caramelized, Nutty |
| line | Caramelized, Nutty | Caramelized, Nutty |
| text shown | surprise note: A blend built on caramelized and nutty notes typically settles into comfort, yet this one keeps you reaching for another sip with its restless fragrance and surprisingly crisp finish that refuses to linger. / three voices: The roaster calls it caramelized and nutty, and we tasted both notes too. This medium-roasted blend offers moderate sweetness balanced by gentle acidity, with a body that sits comfortably in the middle ground. The finish is brief, letting the warm caramel and roasted nut flavors fade quickly from your palate. / Liam's intake (ai_summary): The roaster calls this medium-roasted blend caramelized and nutty at its core, and we tasted those notes too. The cup has a moderate body with gentle sweetness and restrained acidity, making for an approachable, rounded experience. Bitterness is minimal, though the finish fades quickly rather than lingering. | In the roaster's words: The roaster calls it caramelized and nutty, and we tasted both notes too. This medium-roasted blend offers moderate sweetness balanced by gentle acidity, with a body that sits comfortably in the middle ground. The finish is brief, letting the warm caramel and roasted nut flavors fade quickly from your palate. |

## Part C on test: the loader's output

Dry run (`npx tsx tmp/cp1_on_testdb.mjs src/features/coffee_presentation/load/setMatch2917.ts --expect-db axisandbloom_test --dry-run`):

```
[axisandbloom_test] no active home slot: previewPlacement has no slot to preview
[axisandbloom_test] current assignment: {
  archetype: 'fruity',
  confidence: 'low',
  source: 'cupping',
  sessionId: 37
}
[axisandbloom_test] session for 2026-10-21: s40
[axisandbloom_test] basis (composeBasis): basis: cupping s40 (Dana=no call, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=graham cracker, light citrus, Cinnamon
[axisandbloom_test] rule required: true | rule stored: Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body; roaster classification Fruity kept as evidence
[axisandbloom_test] input: {
  coffeeId: 2917,
  archetype: 'chocolate_nutty',
  confidence: 'medium',
  source: 'cupping',
  sessionId: 40,
  notes: 'Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body; roaster classification Fruity kept as evidence',
  basis: '(json below)'
}
[axisandbloom_test] basis json: {"sessions":[40],"calls":{"Dana":null,"Camila":null},"blind":false,"roaster_present":false,"roaster_form":{"version":1,"respondent":"Kathy Turiano","proposal":"balanced_sweet"},"roaster_remarks":[],"website":["graham cracker","light citrus","Cinnamon"],"merged_range":null,"band":null,"rule":"Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body; roaster classification Fruity kept as evidence"}
[axisandbloom_test] dry run: nothing written
```

Real run (filtered; the input block is the same as above):

```
[axisandbloom_test] no active home slot: previewPlacement has no slot to preview
[axisandbloom_test] current assignment: {
}
[axisandbloom_test] session for 2026-10-21: s40
[axisandbloom_test] basis (composeBasis): basis: cupping s40 (Dana=no call, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=graham cracker, light citrus, Cinnamon
[axisandbloom_test] rule required: true | rule stored: Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body; roaster classification Fruity kept as evidence
[axisandbloom_test] input: {
}
[axisandbloom_test] basis json: {"sessions":[40],"calls":{"Dana":null,"Camila":null},"blind":false,"roaster_present":false,"roaster_form":{"version":1,"respondent":"Kathy Turiano","proposal":"balanced_sweet"},"roaster_remarks":[],"website":["graham cracker","light citrus","Cinnamon"],"merged_range":null,"band":null,"rule":"Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body; roaster classification Fruity kept as evidence"}
[catalog] setMatchArchetype {
  actor: 'coffee presentation brief 2',
  warnings: []
}
[axisandbloom_test] setMatchArchetype warnings: []
[anthropicGuard] aiControls missing from config/sommelier (not yet set, or config not loaded) — using defaults (everything enabled, $20/day global)
[anthropicGuard] aiControls missing from config/sommelier (not yet set, or config not loaded) — using defaults (everything enabled, $20/day global)
[anthropicGuard] spend feature=coffee_content model=claude-haiku-4-5-20251001 input=1340 cache_write=0 cache_read=0 output=98 usd_micros=1830
[anthropicGuard] spend feature=coffee_content model=claude-haiku-4-5-20251001 input=599 cache_write=0 cache_read=0 output=234 usd_micros=1769
[axisandbloom_test] regenerated three_voice_story: The roaster calls this blend hazelnut-forward with a hint of citrus fruit and cinnamon, and we tasted the hazelnut and citrus fruit too. Per the roaster, it's beautifully balanced with moderate body and sweetness, a composed acidity, and a measured finish. The roaster recommends it with milk or black, and notes it brews well across methods from auto drip to pour over to espresso.
[axisandbloom_test] /flavor-wheel line: Hazelnut / a hint of fruity: citrus fruit; a hint of spices: cinnamon
[axisandbloom_test] line matches the brief (PASS)
[axisandbloom_test] /story dialPosition: null
```

Second run: `current match already is chocolate_nutty; nothing written`. Assignments of 2917 on test: 1210 `fruity` low s37 (superseded), 1785 `chocolate_nutty` medium s40, `basis.rule` = your note.

## comments.sql lines (new or changed)

```
COMMENT ON TABLE archetype_vector IS $c$Purpose: Seed hypothesis (May 2026 assumed targets): target score range per archetype per flavor dimension (ideal, min, max). No customer-facing sentence reads it since coffee presentation brief 2; read by v_archetype_vectors (GET /api/coffees/archetype-order orders the Bloom page's archetype boxes by distance over it, open), v_archetype_dimension_comparison (admin) and dialSuggestion.getDialSuggestion (review 5.1, open) | Class: operating | Writer: seed | Readers: v_archetype_vectors, v_archetype_dimension_comparison | Since: 2026-05-22$c$;
COMMENT ON TABLE coffees IS $c$Purpose: Coffee catalogue master: one row per coffee, owned by one roaster, with metadata, lifecycle flags, QR token and cached AI and story text | Class: master | Writer: admin.PATCH /api/admin/coffees/:id/story, catalogService.createCoffee, catalogService.updateCoffee, catalogService.retireCoffee, catalogService.createCoffeeInTx, catalogService.deactivateRoastery, catalogService.reactivateRoastery, catalogService.restoreCoffee, catalogService.updateCoffeeInTx, coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags, coffees.sanitizeStoredField, qrDoor.mintTokenForCoffee; seed | Readers: v_coffee, catalogReads, coffees, sommelier, v_archetype_dimension_profile, +11 more | Since: 2026-05-25$c$;
COMMENT ON COLUMN coffees.ai_summary IS $c$Retired from customer surfaces, coffee presentation brief 2 (2026-10-24): cached Claude-generated tasting summary, no longer generated, current values kept; still returned by GET /api/coffees/:id/content and /ai-summary for one release, rendered by nothing; NULLed if a stored value looks like a refusal | Writer: coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.surprise_note IS $c$Retired from customer surfaces, coffee presentation brief 2 (2026-10-24): cached Claude-generated surprise note, no longer generated, current values kept; still returned by GET /api/coffees/:id/content for one release, rendered by nothing; NULLed if a stored value looks like a refusal | Writer: coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.three_voice_story IS $c$The one description per coffee (coffee presentation brief 2): Claude-generated from the roaster's voice, shown under "In the roaster's words" on the reveal panel and Flavor Intelligence and in the admin "What the customer sees" block, and read by Liam's catalog context (sommelierRag: the Tasting note line and the editorial-completeness order); NULLed if a stored value looks like a refusal | Writer: coffees.generateAndStoreAllContent, coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.ai_summary_generation_failed IS $c$True when Claude genuinely refused or failed to produce ai_summary on a real attempt; frozen since coffee presentation brief 2 (ai_summary is no longer generated), current values kept | Writer: none since coffee presentation brief 2 (was coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags)$c$;
COMMENT ON COLUMN coffees.surprise_note_generation_failed IS $c$True when Claude genuinely refused or failed to produce surprise_note on a real attempt; frozen since coffee presentation brief 2 (surprise_note is no longer generated), current values kept | Writer: none since coffee presentation brief 2 (was coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags)$c$;
COMMENT ON COLUMN coffees.three_voice_story_generation_failed IS $c$True when Claude genuinely refused or failed to produce three_voice_story on a real attempt, so the cron backfill skips it; reset by a successful forced retry | Writer: coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags (cleared on active coffees; the only flag it clears since coffee presentation brief 2)$c$;
COMMENT ON TABLE coffee_dimensions IS $c$Purpose: Catalogue of the 12 cupping dimensions that scores, archetype targets and the Bloom Dial are measured on | Class: master | Writer: seed | Readers: v_cupping_scores_readable, v_archetype_vectors, v_coffee_archetype, v_coffee_dimension_range, v_archetype_dimension_profile, +8 more | Since: 2026-05-25 (as dimensions)$c$;
COMMENT ON TABLE evidence_parameter IS $c$Purpose: Thresholds and weights the evidence rules use (cupper_gap, roaster_rank_gap, spearman_min_n, spearman_rho_cut, rank_corr_min_n, calibration_min_n, estimated_date_review_days, website_recapture_days; brief 6: session_rank_ratio, session_half_life_days, session_gap, customer_voice_hit_tier, customer_voice_max_words (closed 2026-10-23, no current row); coffee presentation brief 1: customer_voice_signature_max, customer_voice_accent_max; brief 2: archetype_profile_min_coffees, dimension_delta_slight/_significant), with history; read through param(key), never typed into a view or a .ts file; a change is a new row superseding the current one; each note ends with the key's sane range | Class: master | Writer: evidenceParameterService.setParameterInTx; seed | Readers: param, cuppingService, compatibilityReads, evidenceReads.getParameters (admin System Health, Evidence parameters card) | Since: 2026-10-18 (cupping evidence brief 1; admin-editable since brief 6, 2026-10-21)$c$;
COMMENT ON TABLE coffee_archetype_assignment IS $c$Purpose: Match-archetype tag per coffee with confidence and history; current row has superseded_at NULL | Class: master | Writer: catalogService.setMatchArchetypeInTx; seed | Readers: v_coffee, v_archetype_dimension_comparison, v_archetype_dimension_profile, catalogIntegrity, dialSuggestion, +4 more | Since: 2026-05-25 (as archetype_assignments)$c$;
COMMENT ON VIEW v_archetype_vectors IS $c$Purpose: Target flavor vector per archetype, one row per archetype x dimension with min, ideal and max score. | Class: view | Writer: none (derived) | Readers: coffees (GET /archetype-order distance; GET /api/axis/vectors removed, coffee presentation brief 2) | Since: 2026-06-12$c$;
COMMENT ON VIEW v_archetype_dimension_profile IS $c$Purpose: An archetype's actual profile, one row per archetype x dimension over the active coffees whose current match is that archetype and that have a pooled midpoint (v_coffee_dimension_range): avg_midpoint, min_midpoint, max_midpoint, coffee_count and coffee_ids (int[]), coffee_dimensions.id throughout; the reference the customer's compatibility sentence compares a coffee to, leaving that coffee out of its own archetype's profile. | Class: view | Writer: none (derived) | Readers: compatibilityReads | Since: 2026-10-24 (coffee presentation brief 2)$c$;
COMMENT ON VIEW v_coffee_dimension_range IS $c$Purpose: Per active coffee and dimension, the range POOLED over every session's current merged row, converted to 0 to 15, weighted by rank (param session_rank_ratio) and recency (param session_half_life_days); session_id/session_date are the latest session; adds n_sessions_pooled, weight_latest_share, session_weights, sessions_disagree (param session_gap), rank_ratio, half_life_days; unmerged fallback as before. | Class: view | Writer: none (derived) | Readers: cuppingReads (dialSuggestion, routes/coffees, brewCard, roasterVoiceReads), roasteryPortalReads, customerIntegrity, v_archetype_dimension_comparison, v_archetype_dimension_profile (compatibilityReads), v_coffee_dimension_range_calibrated, v_palate_shared_traits, v_palate_dominant_dimensions, v_palate_slot_candidates, v_roastery_portal_dimension_match, v_evidence_dimension, v_evidence_archetype | Since: 2026-09-27 (pooled since 2026-10-21, cupping evidence brief 6)$c$;
```

## Tests, lints, builds

- **New tests (16):** `src/db/coffeePresentation2.test.ts` (10) and `src/services/coffeePresentation2.test.ts` (6), all pass.
  - View: three fixture coffees give `coffee_count` 3 and the mean; an inactive coffee and a superseded assignment are excluded.
  - Read: leave-one-out; `below_min_coffees` at the seeded 4, `ok` at the param; `customer_bags` → `not_built`; unknown archetype → `no_reference`; delta 3.5 reads "slightly" at 4 and "significantly" at 3.
  - Sentence shapes: all three equal the old `getDimensionComparison` output.
  - Parameter pair: slight must stay below significant; the numeric range parses.
  - Route: no coffee name, roaster or origin over 22 active coffees × 5 archetypes.
  - Backfill and refresh-content: a coffee with a description is not a candidate; `refresh-content` writes the story fields only and leaves `ai_summary` / `surprise_note` and their flags as they were.
  - Loader: the dry run writes nothing; the real run supersedes and keeps the old row; a second run skips.
  - Frontend side: `TastingNotes` is rendered for real (React from the frontend's node_modules); no summary, surprise, legend or intake markup in either variant; the teaser is the signature line.
- **Brief 1's tests:** green.
- **Lints:** `lint:cupping` (after moving the session lookup onto `cuppingReads.listSessions`), `lint:lineage`, `lint:catalog`, `lint:roastery-portal`, `lint:customer` and `lint:retention` are clean.
- **Builds:** backend `tsc --noEmit` clean; frontend `vite build` clean. Frontend `tsc`: the only error in a touched file is `ArchetypeSection`'s stale `hops` prop, which predates this brief.
- **Catalog integrity:** `runCatalogIntegrityChecks().allPass` is true (vitest globalSetup).
- **`comments.sql`:** re-applied to test, 1328 statements, 0 uncommented. `catalog:md` against test renders the new view correctly; the file was restored and will be regenerated from prod.
- **Full suite: 862 tests, 852 pass, 10 fail.**
  - 6 are the known OT-19 quiz-scorer tests.
  - 3 are in `evidenceViews.test.ts`. They pin Blossom and Volo to session 37 ("cupped only in s37"), but cupping brief 7 loaded both into session 41 on test on 2026-10-23, and the views follow the latest session. Not from this brief: no `v_evidence_*` view changed. Brief 7's tests need updating; I left them as they are.
  - 1 was `comments.format` (my `evidence_parameter` comment at 1049 characters). Fixed (now under 1000), and it passes on rerun.
- **Screenshots (1440, test, guest):**
  - `cp2_reveal_panel_1440.png`: Balanced, Classic Balanced (2905), with "In the roaster's words".
  - `cp2_flavor_intelligence_1440.png`: Classic Balanced; one description, no Liam's intake.
  - A C&N reveal panel is not possible on test (nothing placed); it is a prod check after the deploy.

## Prod steps (on your go)

1. Deploy (commit + push to main; GitHub Actions → Cloud Run). Boot applies the view, the three parameter rows and `comments.sql`.
2. `load/setMatch2917.ts --expect-db axisandbloom --dry-run`, then the real run. It prints `previewPlacement` warnings for the C&N slot 1 home, the basis, the regenerated text, the line and `/story` `dialPosition`, which should be non-null on prod.
3. Verify 2917 (`/flavor-wheel`, `/story`, `/compatibility?userArchetype=chocolate_nutty`) and one C&N page, with a 1440 screenshot of the C&N reveal panel.
4. `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md` and the prod results here.

## Open

- `archetype_vector` readers left: `dialSuggestion.getDialSuggestion` (review 5.1) and `GET /api/coffees/archetype-order` (the Bloom box order).
- The sentence still renders for 76 of 110 coffee × reader pairs on test (above). Raise `archetype_profile_min_coffees` if that is not what you want yet.
- ~~The note's "roaster classification Fruity" vs the form's Balanced~~: reworded by Dana 2026-10-24 (prod results below).
- ~~Flavor Intelligence's "three lenses" subtitle~~: replaced on Dana's go 2026-10-24 (prod results below).
- `getCoffeeSummary` / `getCoffeeSurpriseNote` have no caller; delete them in a later brief together with brief 1's snapshot entries.

## Prod (Dana's go, 2026-10-24)

**Changes first (Dana's go message):**
1. **Loader note reworded** to "Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence."
   - Test dry run with it (test already holds the earlier wording; 2917 is chocolate_nutty there, so nothing was written):
     ```
     [axisandbloom_test] no active home slot: previewPlacement has no slot to preview
     [axisandbloom_test] session for 2026-10-21: s40
     [axisandbloom_test] basis (composeBasis): basis: cupping s40 (Dana=no call, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=graham cracker, light citrus, Cinnamon
     [axisandbloom_test] rule required: true | rule stored: Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence.
       basis: '(json below)'
     [axisandbloom_test] basis json: {"sessions":[40],"calls":{"Dana":null,"Camila":null},"blind":false,"roaster_present":false,"roaster_form":{"version":1,"respondent":"Kathy Turiano","proposal":"balanced_sweet"},"roaster_remarks":[],"website":["graham cracker","light citrus","Cinnamon"],"merged_range":null,"band":null,"rule":"Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence."}
     [axisandbloom_test] current match already is chocolate_nutty; nothing written
     [axisandbloom_test] dry run: nothing written
     ```
2. **Flavor Intelligence subtitle** is now "Every coffee in the roaster's words, with what we tasted too and what customers add."
3. **`archetype_profile_min_coffees`** stays at 4.

**Deploy.**
- Commit `0f12129` (this brief's 30 files only), pushed to main, revision `axis-bloom-backend-00773-r54`.
- Boot: "DB schema verified", `[db-comments] applied 1328 statements`. The data catalog reports 2 of 6 checks with findings: the stale `CATALOG.md` (expected before regeneration) and the 22 known dead-table candidates.
- `/health` 200; `GET /api/axis/vectors` 404.
- The deployed frontend bundle carries "In the roaster's words", the new subtitle and the `/compatibility` call, and no longer has "three lenses" or `/api/axis/vectors`.

**Part C dry run (prod):**

```
[axisandbloom] previewPlacement (home slot 24, chocolate_nutty #1) warnings: [{"kind":"band_no_spec"},{"kind":"placement_diverges_from_match","match":"fruity","placement":"chocolate_nutty"}]
[axisandbloom] current assignment: {
  archetype: 'fruity',
  confidence: 'low',
  source: 'cupping',
  sessionId: 37
}
[axisandbloom] session for 2026-10-21: s40
[axisandbloom] basis (composeBasis): basis: cupping s40 (Dana=no call, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=graham cracker, light citrus, Cinnamon
[axisandbloom] rule required: true | rule stored: Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence.
[axisandbloom] input: {
  coffeeId: 2917,
  archetype: 'chocolate_nutty',
  confidence: 'medium',
  source: 'cupping',
  sessionId: 40,
  notes: 'Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence.',
  basis: '(json below)'
}
[axisandbloom] basis json: {"sessions":[40],"calls":{"Dana":null,"Camila":null},"blind":false,"roaster_present":false,"roaster_form":{"version":1,"respondent":"Kathy Turiano","proposal":"balanced_sweet"},"roaster_remarks":[],"website":["graham cracker","light citrus","Cinnamon"],"merged_range":null,"band":null,"rule":"Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence."}
[axisandbloom] dry run: nothing written
```

**Part C real run (prod, filtered; the input block is as above):**

```
[axisandbloom] previewPlacement (home slot 24, chocolate_nutty #1) warnings: [{"kind":"band_no_spec"},{"kind":"placement_diverges_from_match","match":"fruity","placement":"chocolate_nutty"}]
[axisandbloom] current assignment: {
[axisandbloom] session for 2026-10-21: s40
[axisandbloom] basis (composeBasis): basis: cupping s40 (Dana=no call, Camila=no call; not blind); roaster form v1 (Kathy Turiano)=balanced_sweet; roaster remarks=none; website=graham cracker, light citrus, Cinnamon
[axisandbloom] rule required: true | rule stored: Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence.
[catalog] setMatchArchetype {
  actor: 'coffee presentation brief 2',
  warnings: []
[axisandbloom] setMatchArchetype warnings: []
[anthropicGuard] aiControls missing from config/sommelier (not yet set, or config not loaded) — using defaults (everything enabled, $20/day global)
[anthropicGuard] aiControls missing from config/sommelier (not yet set, or config not loaded) — using defaults (everything enabled, $20/day global)
[anthropicGuard] spend feature=coffee_content model=claude-haiku-4-5-20251001 input=1345 cache_write=0 cache_read=0 output=96 usd_micros=1825
[anthropicGuard] spend feature=coffee_content model=claude-haiku-4-5-20251001 input=606 cache_write=0 cache_read=0 output=242 usd_micros=1816
[axisandbloom] regenerated three_voice_story: The roaster calls this blend hazelnut forward with a hint of citrus fruit and cinnamon, and we tasted the hazelnut and citrus fruit too. Beautifully balanced across a moderate body, it drinks equally well black or with milk, and the roaster recommends brewing it however suits you: auto drip, pour over, or espresso all bring out its character. A medium roast with a lingering finish.
[axisandbloom] /flavor-wheel line: Hazelnut / a hint of fruity: citrus fruit; a hint of spices: cinnamon
[axisandbloom] line matches the brief (PASS)
[axisandbloom] /story dialPosition: {"label":"Lighter","sortOrder":1}
```

- **Assignments for 2917 on prod:** 1210 `fruity` low s37 is kept with `superseded_at`; 1230 `chocolate_nutty` medium s40, `basis.rule` = the reworded note.
- **Cost:** 2 Claude calls, $0.0036. Like brief 1's loaders, the local run used the guard's default `aiControls` because the Firestore config isn't loaded in a script.

**Checks on prod (live API).**
- `GET /api/coffees/2917/story`: `archetype` chocolate_nutty, `dialPosition` `{"label":"Lighter","sortOrder":1}` (non-null).
- `GET /api/coffees/2917/flavor-wheel`: Hazelnut (signature); Citrus Fruit (accent, Fruity); Cinnamon (accent, Spices). That renders "Hazelnut / a hint of fruity: citrus fruit; a hint of spices: cinnamon", as the brief expected.
- `GET /api/coffees/2917/compatibility?userArchetype=chocolate_nutty`: `below_min_coffees`, 3 reference coffees, so a C&N customer sees the badge alone. With `userArchetype=fruity`: "This coffee's profile sits close to your usual Fruity preference." (8 coffees).
- **Sentence coverage on prod** (`compareCoffee` over 22 active coffees × 5 reader archetypes):
  - C&N, Balanced and Earthy readers: 18 of 22 (their profiles hold 4 coffees).
  - Fruity readers: 22 of 22 (8 coffees).
  - Floral readers: 0 of 22 (2 coffees).
  - 76 of 110 in all, the same as test.
- **C&N reveal panel at 1440:** `cp2_prod_cn_reveal_panel_1440.png`, Coado (2914, the C&N landing coffee): "In the roaster's words", the signature line, the badge row as a guest.
  - The public domain shows a Cloudflare bot check to headless browsers (not bypassed), and the Firebase URL's pre-launch gate hides `/bloom`.
  - So the shot is the deployed commit's frontend run locally against the prod API, as a guest, with every non-GET request blocked. The blocked requests were App Check, an anonymous sign-up and one client-error post, so nothing was written to prod.
- **2917's story-page text** (`coffees.story`, HOME_TASK_5's story layer, regenerated by the same refresh) names Colombia and Mogiana, Brazil, and has one em dash ("leads—bright"). Dana's no-dash and no-place rules apply to the three customer texts, not to the story layer, so this is left as generated and reported here.

**Catalog.** `npm run catalog:md -- --expect-db axisandbloom` gives catalog-hash `dc2b165cf089…`, the same as revision 00773's live hash, so the stale finding clears at the next deploy.

**Remaining open:**
- `archetype_vector` readers: `dialSuggestion.getDialSuggestion` and `GET /api/coffees/archetype-order`.
- The sentence renders for 76 of 110 coffee × reader pairs at the minimum of 4 (Dana: keep 4).
- `evidenceViews.test.ts` needs updating for brief 7's session 41 (3 failures).
- `getCoffeeSummary` / `getCoffeeSurpriseNote` have no caller.
- 2917's story-page text (above).
