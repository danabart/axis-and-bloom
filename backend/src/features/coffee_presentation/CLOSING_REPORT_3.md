# Coffee presentation, brief 3: closing report

> Brief: `CLAUDE_CODE_PROMPT_COFFEE_PRESENTATION_3.md` · Run 2026-10-24 on the **test DB** (`axisandbloom_test`) · `WHAT_WE_BUILT.md` #234, `WHAT_WE_BUILT_DB.md`
> **Status: done on test, waiting for Dana's go for prod.** Nothing pushed or deployed; prod not read.

## Where the code or the data differs from the brief

1. **The story's banned-term list bans the word "roaster".** `storyLayer.bannedTerms` (config, HOME_TASK_5) is farm, co-op, coop, cooperative, estate, lot, importer, **roaster**, roastery. Decision 4's attribution ("the roaster calls it") would fail every try, so the story would never update. For the full story only, I let the one generic word "roaster" through.
   - Still rejected: the roaster's names (`roasterNames`, the leak tokens), "roastery", and the rest of the list.
   - Unchanged: the brew-note and order-placed sentences keep the full list.
   - Config not touched. If you'd rather not, the alternative is an attribution without the word (e.g. "in the words of the people who roast it").
2. **The adjacency view is empty on test.** `v_coffee_archetype_adjacency` has no row there: bridge hops need two placed active coffees in different archetypes, and few test coffees have a home slot. So every matched box order on test is "own, then `sort_order`" (table below). Prod's order depends on its bridge hops; I have not read prod. Your note in `WHAT_WE_BUILT.md` already says only `balanced_sweet ↔ floral` had an authored bridge hop, so prod is likely close to sort_order too.
3. **There is no "suggestion column" on the Dimensions tab.** The suggestion reaches the admin only through the signal's notes, shown as "Dial signal basis" on the *Archetype & slot* tab. That tab is one component (`ArchetypeTab`), shared by the Coffees-page evidence panel and the Calibration workbench. That is where "no band on slots 1, 2, 3, 4" now shows in grey (full notes on hover). No new read was needed and no view changed.
4. **`archetype_vector` had two more readers through `v_archetype_dimension_comparison`:** `GET /api/coffees/archetype-stats` (no caller) and `dialSuggestion.getArchetypeBucketWidth` (the admin hop-suggestion gap). **Resolved on your go, see "Changes on Dana's go" below.**
5. **The story stops naming the coffee by its archetype.** Most test coffees have no home slot, so the old fallback named them by the archetype label: 2917's old story opened "Chocolate & Nutty pulls from…". The story now uses the display name, else "this coffee", like the description does since brief 1.
6. **One check added beyond the brief:** "we tasted" is rejected when our cupping confirmed none of the roaster's notes. On the first test run 2935 said "we tasted it too" with nothing confirmed. On the second run the check caught it, plus 2928, and both passed on retry.
7. **Signal notes keep brief 6's pooled tail:** `no suggestion: slot(s) 1, 2, 3, 4 of Fruity have no band; pooled 2 sessions (ratio 0.667, half-life 365 d), latest s40`. Your text is the head, word for word.
8. **`writeDialPositionSignal`** writes feedback rows (direction more/less), which never carry a suggested slot. Nothing changed there; only `recordCuppingSignal` writes the no-band notes.

## Changes on Dana's go (2026-10-24, on test before prod)

1. **`GET /api/coffees/archetype-stats` removed** (no caller). Its three tests in `coffees.test.ts` are replaced by one asserting the targets are no longer served.
2. **The admin hop-suggestion gap is `param('hop_suggestion_gap')`.** New `evidence_parameter` row, seeded beside brief 2's rows with the same guard: 0.5, `Range: numeric 0 < value <= 15.`
   - The May targets gave a different width per archetype: 0.5 for Floral, Fruity, Balanced and Earthy, but **0.75 for Chocolate & Nutty** (Body 10 to 13 over 4 slots). One row cannot hold both, so I seeded 0.5, the value four of the five produce; the note says so.
   - Effect on test: one more C&N pair clears the gap (2906 / 2914, Body 0.72 apart). Set it to 0.75 on the Evidence parameters card if you want C&N's old threshold everywhere.
   - `dialSuggestion.getArchetypeBucketWidth` is deleted. No frontend code calls the hop-suggestions endpoint (grep).
3. **No code reads `v_archetype_vectors` or `v_archetype_dimension_comparison` now.** `archetype_vector` is read only by those two views. `comments.sql`:
   - the comparison view's Readers is now "none since coffee presentation brief 3 … kept as the admin's hypothesis-vs-actual view";
   - `evidence_parameter` lists `hop_suggestion_gap` (994 chars, under the 1000 stop).
4. **"roaster" stays allowed in stories**, as done.

## What changed

**Part A, box order.** `catalogReads.getArchetypeOrder(match)` holds decision 1 over `v_coffee_archetype_adjacency` (`archetype_a` or `archetype_b`) and `v_coffee_archetype`:
- Own archetype first.
- Then the adjacent archetypes: `hop_count` desc, `avg_confidence` desc (null last), then `sort_order`.
- Then the rest by `sort_order`.
- Unmatched, unknown or non-flavor codes get plain `sort_order`.

`routes/coffees.ts /archetype-order` calls it; the route comment names the rule. Same response shape; the frontend is untouched.

**Part B, slot suggestion.**
- B1 `getDialSuggestion`:
  - The archetype_vector branch and `BASIS_ARCHETYPE_VECTOR` are removed.
  - The return type gains `reason: 'no_band' | null`, `missingBandSlots` (sort orders) and `archetype_label`. `suggested_slot_id`, `suggested_label`, `suggested_sort_order` and `basis` are null when a band is missing.
  - `recordCuppingSignal` records the signal anyway (the midpoint is evidence), with `suggested_slot_id` NULL and the notes above, through the existing insert. The consensus view already ignores NULL slots.
- B2 `comments.sql` (lines below). `CATALOG.md` is regenerated at the prod step (`catalog:md -- --expect-db axisandbloom`), as in brief 2.
- B3 the evidence panel shows the reason (`DialSignalBasis` in `EvidencePanel.tsx`).

**Part C, the story.**
- C1 `storyLayer`:
  - `StoryGenParams` takes `voice` and `archetypeLabels`; `topDescriptors` and `archetype` are gone. `buildStoryPrompt` is exported for the snapshot.
  - The prompt lists the roaster's signature, accent and cupping-confirmed notes, and asks for attribution and "and we tasted it too" only where confirmed. It names the archetype labels from the database in the category rule.
  - `STORY_SYSTEM_PROMPT` and its origin and roaster rules are unchanged.
  - Dashes go through `contentGuard.normalizeDashes` after generation. The same three tries also reject `styleViolation` (labels from the database; its milk check is not applied), our tasting as our own, and an unsupported "we tasted".
  - `StoryGenResult` gains `rejects`.
- C2 `generateAndStoreAllContent` passes `data.voice` and `data.archetypeLabels`. It gains `storyOnly` (the loader's switch; `refresh-content` does not pass it) and returns `storyRun`.
- C3 `load/regenerateStories.ts --expect-db <db> [--dry-run]`.

**Part D, tests.**
- `evidenceViews.test.ts`: the three brief 7 failures, rewritten by coffee id. Blossom 2916 and Volo 2927 assert s37 / s39 on paper from `v_cupping_scores_readable` / `v_cupping_score`, then the views' current row against the pool recomputed in JS from `v_coffee_dimension_history` and `param()`. No session id after s37/s39 is pinned: the Earthy cupping is s385 on test and s41 on prod.
- New `src/db/coffeePresentation3.test.ts`: `getArchetypeOrder` over a fixture adjacency, running its own SQL with the view swapped for a VALUES list (no CREATE); tie on hops broken by confidence, then `sort_order`; unmatched, unknown and non-flavor; the route over the real catalog; no `archetype_vector` / `ideal_score` / Euclidean in the route file.
- New `src/services/coffeePresentation3.test.ts` (mocked DB and SDK):
  - Signal: an unbanded slot records `suggested_slot_id` null with the notes text; all slots banded writes the slot with spec_band.
  - Story: a stubbed reply with dashes comes out dash-free (and "8–10" as "8 to 10"); "highlands of Huila" passes; an archetype category and "Our cupping revealed" reject, then the retry is accepted; "roaster" passes while "roastery" and "farm" reject; an unsupported "we tasted" rejects; the roaster's name still rejects.
  - The prompt snapshot: roaster voice and attribution present, no "Top flavor descriptors", no customer word, no dash.
- `dialSuggestion.test.ts`: the no-band cases replace the archetype_vector one; the banded cases are unchanged.
- `coffeePresentation2.test.ts`: its exact-keys assertion now includes `storyRun`.

## Box order, before / after (test)

`v_coffee_archetype_adjacency` on test: **0 rows**. `sort_order`: floral > fruity > balanced_sweet > chocolate_nutty > earthy.

| match | before (distance over `archetype_vector`) | after (adjacency, then `sort_order`) |
|---|---|---|
| none | floral > fruity > balanced_sweet > chocolate_nutty > earthy | the same |
| floral | floral > fruity > balanced_sweet > chocolate_nutty > earthy | the same |
| fruity | fruity > floral > balanced_sweet > chocolate_nutty > earthy | the same |
| balanced_sweet | balanced_sweet > floral > fruity > chocolate_nutty > earthy | the same |
| chocolate_nutty | chocolate_nutty > earthy > balanced_sweet > fruity > floral | chocolate_nutty > floral > fruity > balanced_sweet > earthy |
| earthy | earthy > chocolate_nutty > balanced_sweet > fruity > floral | earthy > floral > fruity > balanced_sweet > chocolate_nutty |

The visible change is that C&N and Earthy customers no longer see each other second. With no bridge hop between them on test, nothing says they are neighbours.

## Slot suggestion, before / after for the 22 active coffees (computed, not recorded)

No slot of any archetype has a band on test, so every "after" is "no band on slots 1, 2, 3, 4".

| coffee | match | before (archetype_vector targets split across the slots) | after |
|---|---|---|---|
| 2891 | fruity | slot 1 Mellow (Acidity 3.5, outlier) | none, midpoint 3.5 |
| 2902 | fruity | slot 1 Mellow (Acidity 6.5, outlier) | none, midpoint 6.5 |
| 2903 | floral | no merged score | null (no merged score) |
| 2904 | fruity | slot 1 Mellow (Acidity 5, outlier) | none, midpoint 5 |
| 2905 | balanced_sweet | slot 1 Smooth (Acidity 1.28, outlier) | none, midpoint 1.28 |
| 2906 | chocolate_nutty | slot 1 Lighter (Body 6.28, outlier) | none, midpoint 6.28 |
| 2907 | chocolate_nutty | no merged score | null |
| 2908 | earthy | slot 2 Earthy (Bitterness 8.61) | none, midpoint 8.61 |
| 2909 | fruity | slot 1 Mellow (Acidity 7, outlier) | none, midpoint 7 |
| 2914 | chocolate_nutty | slot 1 Lighter (Body 7, outlier) | none, midpoint 7 |
| 2915 | balanced_sweet | slot 1 Smooth (Acidity 3.39, outlier) | none, midpoint 3.39 |
| 2916 | earthy | slot 1 Gentle (Bitterness 6.81, outlier) | none, midpoint 6.81 |
| 2917 | chocolate_nutty | slot 1 Lighter (Body 5.8, outlier) | none, midpoint 5.8 |
| 2927 | earthy | slot 1 Gentle (Bitterness 4.11, outlier) | none, midpoint 4.11 |
| 2928 | floral | no merged score | null |
| 2929 | earthy | slot 1 Gentle (Bitterness 7.46, outlier) | none, midpoint 7.46 |
| 2930 | balanced_sweet | slot 1 Smooth (Acidity 2.5, outlier) | none, midpoint 2.5 |
| 2931 | fruity | slot 1 Mellow (Acidity 9.5, outlier) | none, midpoint 9.5 |
| 2932 | fruity | slot 1 Mellow (Acidity 2, outlier) | none, midpoint 2 |
| 2933 | fruity | slot 1 Mellow (Acidity 1.5, outlier) | none, midpoint 1.5 |
| 2934 | balanced_sweet | slot 1 Smooth (Acidity 4.27, outlier) | none, midpoint 4.27 |
| 2935 | fruity | slot 1 Mellow (Acidity 9.5, outlier) | none, midpoint 9.5 |

18 of the 19 old suggestions were "slot 1, outlier": the May targets sat above every real coffee. Only 2908 landed inside the target range.

## Stories (test, after the second run)

Loader run 1: 22 of 22 passed on the first try, 0 dashes. Run 2 (with the "we tasted" check): 22 passed, 3 rejects (2927 "lot"; 2928 and 2935 an unsupported "we tasted"), all passed on the second try, 0 dashes. No coffee is admin-edited on test. Before this brief every one of the 22 stories had 1 to 4 dashes.

**2914, before** (excerpt): "It's processed using the washed method—the fruit is removed… carrying almond and dark chocolate notes…" (2 dashes, flavor words unattributed).

**2914, after:**
> This coffee comes from the highlands of Central America, where altitude and climate create conditions for complex fermentation. It's been washed, a process that rinses away the fruit before drying, which shapes what you'll find in the cup.
>
> The roaster calls it almond and chocolate forward, with peanuts lending depth. We tasted those too. There's a hint of cherry and dried fruit moving through, per the roaster, though they're understated notes here.
>
> What strikes us most is the restraint. The fragrance and aroma are quiet, almost muted. The flavor itself doesn't shout. You won't find much sweetness or brightness, and bitterness stays minimal. Instead, this coffee builds a moderate body that carries through to a finish with real presence, the kind that lingers after you've set the cup down.
>
> This isn't a coffee that demands your attention immediately. It asks you to sit with it. The structure is grounded and composed, letting those nutty, chocolatey tones unfold without fanfare. It rewards patience and attention, which seems worth noticing in a world of louder cups.

**2917, before** (excerpt): "Chocolate & Nutty pulls from the highlands of Colombia and the Mogiana region of Brazil—two places…" (4 dashes, named by its archetype).

**2917, after:**
> This coffee blends highlands from Colombia with coffees from the Mogiana region of Brazil, both washed to clean up their fruit character. The two origins spend time in water and fermentation before drying, a process that lets the bean structure itself around what matters most here: a core of hazelnut that sits steady and warm.
>
> The roaster calls it hazelnut, and we tasted it too. There's a hint of citrus fruit threading through, along with a whisper of cinnamon from the roast itself.
>
> What's worth noticing is the fragrance. When you first open the bag or grind the beans, the smell comes forward with real presence, immediate and inviting. The cup itself settles into a gentler place. The body lands moderate, not heavy. Acidity is quiet, almost understated. Sweetness builds gradually rather than arriving loud. The finish lingers a little, enough to remind you what you drank after the cup is gone.
>
> This is coffee that asks you to pay attention without demanding it, coffee that reveals itself best when you're not rushing.

**What the guards do not catch (read across all 22):**
- **Invented claims.** "A whisper of cinnamon from the roast itself" (2917), "conditions for complex fermentation" (2914), and run 1's "stone fruit, berries… apricot" for a coffee whose only note is Other Fruit (2931).
- **Literal wheel-node names.** "Other Fruit" reads as "the roaster calls it other fruit" (2928, 2931, 2932, 2935).
- **"Us" as a taster.** "What strikes us most" (2914).
- **The roaster as processor.** "The roaster used a washed process": the roaster did not process the coffee.

There is no deterministic check for these. They are prompt-compliance issues of the same kind as brief 1's.

## `comments.sql` lines

```
COMMENT ON TABLE archetype_vector IS $c$Purpose: Seed hypothesis (May 2026 assumed targets): target score range per archetype per flavor dimension (ideal, min, max). Read only by v_archetype_vectors and v_archetype_dimension_comparison (admin). No customer-facing or decision-making reader since coffee presentation brief 3. | Class: operating | Writer: seed | Readers: v_archetype_vectors, v_archetype_dimension_comparison | Since: 2026-05-22$c$;
COMMENT ON COLUMN dial_position_signal.notes IS $c$For feedback rows a match key such as "onsite feedback for order <id>" that the order-feedback revision path uses to supersede the prior row; for cupping rows written since cupping evidence brief 1 the basis of the suggested slot; since coffee presentation brief 3 either spec_band (every active slot of the archetype has a band) or "no suggestion: slot(s) <n, n> of <archetype> have no band" (no slot suggested), each followed by what the midpoint was pooled from; rows written before brief 3 may name archetype_vector (May 2026 targets), a basis no longer used; NULL on older cupping rows. | Writer: dialPositionSignal.writeDialPositionSignal, dialSuggestion.recordCuppingSignal$c$;
COMMENT ON COLUMN dial_position_signal.suggested_slot_id IS $c$References coffee_dial_slot.id, the slot the source suggests (replaced the dropped suggested_vocabulary_id in brief 5a); set only on cupping rows, NULL for feedback rows and, since coffee presentation brief 3, for a cupping row whose archetype has a slot without a band. | Writer: dialSuggestion.recordCuppingSignal$c$;
COMMENT ON VIEW v_archetype_vectors IS $c$Purpose: Target flavor vector per archetype, one row per archetype x dimension with min, ideal and max score. | Class: view | Writer: none (derived) | Readers: none (GET /archetype-order ordered by distance over it until coffee presentation brief 3, now by adjacency; GET /api/axis/vectors removed in brief 2) | Since: 2026-06-12$c$;
COMMENT ON VIEW v_archetype_dimension_comparison IS $c$Purpose: Archetype target range (min, ideal, max, the May 2026 archetype_vector targets) beside the average midpoint of the latest merged cupping range (v_coffee_dimension_range) of the active coffees matched to the archetype, and their count, per archetype x dimension. | Class: view | Writer: none (derived) | Readers: none since coffee presentation brief 3 (GET /archetype-stats removed; getDialSuggestion reads bands, the admin hop suggestions param('hop_suggestion_gap')); kept as the admin's hypothesis-vs-actual view | Since: 2026-06-12 (latest merged range: 2026-10-18)$c$;
COMMENT ON TABLE evidence_parameter IS $c$Purpose: Thresholds and weights the evidence rules use (cupper_gap, roaster_rank_gap, spearman_min_n, spearman_rho_cut, rank_corr_min_n, calibration_min_n, estimated_date_review_days, website_recapture_days; brief 6: session_rank_ratio, session_half_life_days, session_gap, customer_voice_hit_tier, customer_voice_max_words (closed, no current row); coffee presentation brief 1: customer_voice_signature_max, customer_voice_accent_max; brief 2: archetype_profile_min_coffees, dimension_delta_slight/_significant; brief 3: hop_suggestion_gap), with history; read through param(key), never typed into code; a change supersedes the current row; each note ends with the key's sane range | Class: master | Writer: evidenceParameterService.setParameterInTx; seed | Readers: param, cuppingService, compatibilityReads, admin (hop suggestions), evidenceReads.getParameters (System Health, Evidence parameters card) | Since: 2026-10-18 (cupping evidence brief 1; admin-editable since brief 6, 2026-10-21)$c$;
COMMENT ON VIEW v_coffee_archetype IS $c$Purpose: One row per coffee archetype (all six including experimental) exposing code, label and dial metadata, replacing hand-typed archetype name maps | Class: view | Writer: none (derived) | Readers: catalogReads.getArchetypes (and getArchetypeOrder), routes/axis, roasteryPortalReads, v_coffee_archetype_adjacency | Since: 2026-09-13$c$;
COMMENT ON VIEW v_coffee_archetype_adjacency IS $c$Purpose: Cross-archetype bridge-hop summary (hop counts, more/less split, average confidence) between archetype pairs, from active coffees only | Class: view | Writer: none (derived) | Readers: routes/axis (GET /api/axis/adjacency and stats), sommelierRag, catalogReads.getArchetypeOrder (the Bloom's box order, coffee presentation brief 3) | Since: 2026-09-13$c$;
```

## Verification (test)

- **Full suite after Dana's changes** (rerun): 71 files, 872 passed, 6 failed, all OT-19 (`quizScoring.test.ts`). Lints all exit 0 and `tsc` is clean.
- **First full suite** (before Dana's changes): 71 files, 872 passed, 7 failed.
  - 6 are OT-19 (`quizScoring.test.ts`, known).
  - 1 was `coffeePresentation2.test.ts`'s exact-keys assertion, which this brief's `storyRun` broke; fixed, and the file now passes 10 of 10.
  - Brief 7's three `evidenceViews.test.ts` tests pass (32 of 32).
- New and changed tests: `coffeePresentation3` (db 7, services 9), `dialSuggestion` 5, all pass.

- Lints: `lint:cupping` clean, `lint:lineage`, `lint:catalog`, `lint:roastery-portal` clean, `lint:customer`, `lint:retention` all exit 0.
- Builds: backend `tsc` and frontend `vite build` clean.
- `runCatalogIntegrityChecks().allPass = true` on test.
- No `CREATE`, `ALTER` or delete; the only DB writes on test were the 22 stories (twice) through the content writer.

## Prod, on your go

1. Commit this brief's files to main and push (deploy: Actions to Cloud Run).
2. `load/regenerateStories.ts --expect-db axisandbloom --dry-run`, then the real run. Prints 2914 and 2917.
3. Verify `GET /api/coffees/archetype-order?archetype=chocolate_nutty` (with prod's adjacency printed beside it) and 2917's story (`/api/coffees/2917/story`).
4. `npm run catalog:md -- --expect-db axisandbloom`, commit `CATALOG.md` and the prod section of this report.
