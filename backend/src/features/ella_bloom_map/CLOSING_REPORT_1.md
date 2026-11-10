# Closing report — Ella's Bloom Map 1: Schema, rules, preview

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_1_SCHEMA_RULES_PREVIEW.md` · Run 2026-11-10 · Test mode.

**Status: done in test mode.** Built: Part A schema, Part B services and API, Part D tests, and acceptance on the test DB. The deploy and its evidence are at the end. Task 0 stopped once for Dana. Her decisions of 2026-11-10 are recorded below, and the run then went on as one run.

## Where the data came from

- **Task 0, first pass:** read on the test DB. The classifier blocked production reads.
- **Task 0, after Dana allowed the read-only runner:** item 10 and the prod checks on items 2 and 7 were redone on production (read-only transactions). Production matches the test DB on every pooled value and every sellable flag except **Feminista's Body: 5.85 on prod, 6.77 on test.** That is brief 9's dispute 1. The test DB has no `cupping_score_dispute` table, so it predates brief 9 (OT-121). As Dana said, acceptance ran on the test DB as it is.

---

## Task 0 findings

### 1. CATALOG.md check, dimension ids

- **No Part A object exists under any name.** `CATALOG.md` and the test DB have only `dial_position_signal` and `dial_source_weight` with the `dial_` prefix. There are no `dial_lane`, `dial_move`, `dial_evidence_grade`, `dial_map_version*`, `dial_first_match*`, `dial_provisional_sample_pattern`, `dial_seam`, `dial_wedge`, `dial_ring_cut`, `dial_size_cut`, `dial_placement`, `dial_hop_phrase`, `coffee_lean_assignment` or `v_dial_*` objects. Nothing else holds a per-coffee ring, lane or size, a map version, a pairwise coffee relation or a lean decision. `coffee_dial_slot` is a ladder per archetype and is read by subscriptions. `coffee_hop` is the retired-to-be hop table.
- `dial_archetype_config` is dropped (comment at `schema.sql:2727`). `coffee_archetype` owns `has_bloom_dial`, `is_archetype` and `dominant_dimension_id`.
- **Name collision to avoid:** `dial_position_signal` and `dial_source_weight` (the old consensus advisory) already use the `dial_` prefix. The new objects don't collide with them. Brief 4 retires them under the same prefix.
- `coffee_dimensions` (column `name`, no `code`): **4 Sweetness, 5 Acidity, 6 Bitterness, 7 Body.** The brief's "7 chocolate_nutty, 5 balanced and fruity, 9 floral, 6 earthy" are the quiz's `dominant_dimension_id` values: C&N = Body, Balanced/Fruity = Acidity, Floral = 9 Savory / Depth, Earthy = Bitterness. The map's rulers are therefore bitterness = 6 and acidity = 5, so `dial_wedge.ruler_dimension_id` really is a different fact from `dominant_dimension_id`. This confirms CTO call 3.
- `coffee_archetype`: the five families plus `experimental` all have `has_bloom_dial = true`. `experimental` has `is_archetype = false`, which confirms CTO call 2. No active coffee is `experimental`.

### 2. Pooled values

- `v_coffee_dimension_range` columns: `coffee_id, dimension_id, dimension_name, value_min, value_max, n_scores, basis, session_id, session_date, n_sessions, midpoint, all_ab_scale, n_sessions_pooled, weight_latest_share, session_weights, sessions_disagree, rank_ratio, half_life_days`. It covers active coffees only and is already on the 0–15 scale.
- **A missing dimension shows as no row**, not a row with NULL. The Daily and La Familia have no Body row. Ten of the twelve active coffees have all four dimensions.
- **"Eighteen coffees" is really twelve.** The workbook's Placement sheet has 18 rows. Six of them are not catalog coffees: Brazil, D.R. Congo and Indonesia (not in catalog), and The Waverly, Half Moon and Great Heights (lineup only). The catalog has 12 active Joe coffees (Joe Bean 4, Joe Coffee 8).

Workbook (Acidity / Sweetness / Bitterness / Body, columns J–M) beside the test DB midpoints:

| Coffee | Workbook A / S / Bi / Bo | DB A / S / Bi / Bo | n pooled | Differs |
|---|---|---|---|---|
| Tiger Stripe | 4 / 3 / 3.25 / 6.5 | 4.5 / 3.5 / 3.5 / 7 | 1 (s37) | all four |
| Fabricator | 4 / 3.5 / 4 / 6 | 4.78 / 5.06 / 3.8 / 5.8 | 2 (s37, s40) | all four |
| Geometric | 3 / 8.5 / 2.5 / 4 | 4.66 / 7.04 / 1.29 / 7.23 | 3 (s37, s40, s42) | all four |
| Blossom | 1 / 3.5 / 7 / 8 | 0.61 / 3.11 / 6.81 / 8.39 | 2 (s37, s41) | all four |
| Benchmark | 0.5 / 5 / 1.5 / 4.5 | 1.28 / 6.57 / 2.09 / 4.5 | 2 (s36, s40) | A, S, Bi |
| The Daily | 3.5 / 7.5 / 5 / – | 3.5 / 7.5 / 5 / – | 1 | none |
| Big City | 1 / 4 / 9 / 7 | 1 / 4.39 / 8.61 / 7.39 | 2 (s36, s41) | S, Bi, Bo |
| Amsterdam | 0.5 / 5 / 5.5 / 5.5 | 1.28 / 5.2 / 5.89 / 6.28 | 2 (s36, s41) | all four |
| Cafè Feminista | 6.5 / 8 / 1.5 / 4 | 8.04 / 8.31 / 0.58 / 6.77 (prod Body 5.85) | 2 (s36, s42) | all four |
| La Familia | 5 / 8.5 / 3.5 / – | 5 / 8.5 / 3.5 / – | 1 | none |
| The Village | 5 / 6 / 2.5 / 6 | 4.38 / 6 / 1.58 / 6.31 | 2 (s36, s42) | A, Bi, Bo |
| Nightcap Decaf | 7 / 6 / 4 / 9 | 7 / 6 / 4 / 9 | 1 | none |

**Why they differ:**
- The workbook took Coffee_Map 2026-11-02 midpoints. The view is the brief 6 pool, weighted by rank and recency.
- Session 42 (2026-11-06, after the workbook's sources) adds Geometric, Feminista and The Village.
- Coffees from one Dana-only session (Daily, La Familia, Nightcap) match exactly.
- Tiger Stripe has one session but still differs. My reading, not verified: the view takes the midpoint of the merged range (union of both cuppers), while the workbook averaged the cuppers.

**What this does to the Rev 3 section 6 hand run**, at cuts 4 / 6.5 (my reading; the real preview will print it):
- Geometric moves from acidity 3 (ring 1) to 4.66 (**ring 2**).
- Feminista moves from 6.5 (ring 2) to 8.04 (**ring 3**).
- Fabricator's 3.8 is inside the 0.25 margin of cut 1 (it will be flagged).
- Size changes: Fabricator 1 → 2 and Benchmark 2 → 3.
- So section 6's hops will not reproduce one-to-one. The brief expects this ("every difference listed with its cause").

### 3. Words with position — **contradicts the brief**

- **There is no portal rank bug in the writer.** `roasteryPortalService.saveDraft` (`roasteryPortalService.ts:610-616`) writes `rank = i + 1` in the order the UI sends. The portal UI (`NotesSection.tsx`) has one row per note with move up/down.
- **What really happened:** for every submitted Joe response, the roaster typed the whole list into **one** note. So each response has exactly one note row: rank 1, `roaster_words` = "Chocolate, Peanut Butter, Pear, Fig, Almond, Cherry", and a single wheel pick that is often not the first word (Tiger Stripe → Cherry, Benchmark → Nutmeg). Geometric's response has no notes at all.
- **The order is in the text, and G2.20 says we never edit data we received.** So I did not apply a "one-line writer fix", and there is nothing to fix in the writer. The fix is on the read side: `v_dial_placement_input` splits `roaster_words` on commas with ordinality.
- I checked that split on the test DB. Normalised with lower + btrim + collapsed whitespace (the same as `v_evidence_unmapped_words`) and mapped through `v_note_mapping_current` (`source_kind = 'roaster'`) → `v_cupping_note_family`, it resolves almost every word. The unmapped ones are Milk Duds, Graham Cracker and Cola. Examples: Tiger Stripe Nutty/Cocoa at 1, Fruity at 3. Fabricator Nutty/Cocoa at 1, Fruity at 2. Village Floral at 1, Fruity at 2. La Familia Fruity at 3.
- **No existing view gives "first position of a family word per source":**
  - `v_coffee_customer_descriptor.roaster_rank` reads only the note's single wheel pick (`form_rank` CTE, `schema.sql:~8982`), so it holds one family per coffee, all at rank 1.
  - `v_evidence_descriptor` gives a family's presence per source, but no position.
  - So `v_dial_placement_input` must compute the split itself, over `v_roastery_portal_current_response` + `roastery_portal_coffee.coffee_id`.
- **Website order is not kept anywhere.** `roastery_remark` website rows (channel `website`, topic `descriptor`) are one row per word with a UUID id. One capture per coffee has a single `load_dts` and `said_on`, and there is no ordinal column. `roastery_coffee_descriptors` has no order column either: for the four Joe Bean coffees it is one row with the full list in `notes` and one node.
  - So "website order" can't be computed. Website words can only count as **present** (family present in that source).
  - Proposal: read them through `v_evidence_descriptor.named_by_roaster_website`, with the position NULL and `inputs_used` saying so, or leave the website source out of the suggestion. Your call.
- **Workbook detail that differs:** Big City's "Burnt Sugar" maps to Brown Sugar → *Sweet*, not Roasted. The workbook counted it as roasted through the portal pick Smoky. With the mappings as they stand, no active Joe coffee has a Roasted-family word. The dark-roast term comes only from roast level.

### 4. Roast level

- It lives in `coffees.roast_level` (via `v_coffee.roast_level`), in `roastery_portal_coffee.roast_level` (prefill, via `v_roastery_portal_coffee`) and in `roastery_portal_response.roast_level`. `roast_shade` is empty.
- All three agree for every active coffee: dark for Blossom and Big City; light for Feminista, La Familia and Village; medium for the rest.
- **Amsterdam has no structured conflict.** It is medium in all three. The "disputed" value is a free-text website remark, `topic = 'roast'`, "a deeper roast profile". The workbook said dark.
- Rule I propose for the dark flag: `v_coffee.roast_level IN ('dark', 'medium-dark')`, with the dark set read from a lookup or parameter rather than typed into the view (G2.1). The roast remark is shown in `inputs_used` only.

### 5. Cupping rows for the grade

| Coffee | Merged sessions | Cuppers (scale) | Sample notes | Control |
|---|---|---|---|---|
| Amsterdam | 36, 41 | Dana, Camila (ab_0_15) | page refs | no |
| Benchmark | 36, 40 | Dana, Camila | page refs | **yes (s40)** |
| Big City | 36, 41 | Dana, Camila | page refs | no |
| Blossom | 37, 41 | Dana, Camila | page refs | no |
| Feminista | 36, 42 | Dana, Camila | page refs | no |
| La Familia | 36 | Dana | – | no |
| Fabricator | 37, 40 | Dana, Camila | page refs | no |
| Geometric | 37, 40, 42 | Dana, Camila | page refs | **yes (s42)** |
| Nightcap | 36 | Dana | **"last cup of the day; Dana considers her scores provisional"** | no |
| The Daily | 36 | Dana | – | no |
| The Village | 36, 42 | Dana, Camila | page refs | no |
| Tiger Stripe | 37 | Dana, Camila | – | no |

- Distinct `sample_note` values in the DB:
  - page/sample references ("Dana page 2 sample 1; Camila page 6 sample 1", etc.)
  - "end-of-run lot" (2 samples, Utopian s38, inactive)
  - "last cup of the day; Dana considers her scores provisional" (Nightcap)
  - NULL
- `%last cup%` catches Nightcap only. "end-of-run lot" is a candidate second pattern; it is only on inactive coffees, so it is not seeded unless you say so.
- **Every cupper row is `ab_0_15`.** The "non-0-15 cupper counts as half" rule never fires on current data; only the fixture tests will exercise it.
- **Grade A is unreachable at the brief's defaults.** Only two cuppers exist (Dana, Camila) and `dial_grade_cuppers_for_a` is 3. My reading at the defaults:
  - B: Benchmark, Tiger Stripe, Fabricator, Blossom, Geometric, Village, Feminista, Amsterdam, Big City
  - C: La Familia, The Daily
  - D: Nightcap
  - Section 6 had Tiger Stripe at A and Village and Feminista at C. This is a calibration question, not a model one.
- **Open choice:** whether a control sample (`is_control`) counts as a session for the grade. I propose yes, because it is a real cupping; Benchmark and Geometric are affected.
- **Sources:**
  - `v_cupping_score` gives sessions, cuppers and `scale_code` per current row (it has `session_id`, `coffee_id`, `is_merged`, `cupper_id`, `scale_code`).
  - `sample_note` and `is_control` are not in it. They are in `v_cupping_session_coffee` (an existing view), so no new base read is needed: `v_cupping_score` join `v_cupping_session_coffee` on `session_coffee_id`.

### 6. Family and lean today

- Current `coffee_archetype_assignment` rows for the 12 active Joe coffees:
  - chocolate_nutty: Amsterdam, Blossom, Fabricator, Tiger Stripe, The Daily
  - balanced_sweet: Benchmark
  - earthy: Big City
  - fruity: Feminista, Geometric (s42, 2026-11-09), Village, Nightcap
  - floral: La Familia
  - **Tiger Stripe's row (1229, manual, 2026-10-22) has no notes and no basis.** It is already listed by `evidenceIntegrity` #6.
- No active `experimental` coffees.
- `setMatchArchetypeInTx(tx, { coffeeId, archetype, confidence, source, sessionId?, notes?, basis? })` (`catalogService.ts:824`) works like this:
  1. `assertBasis`, then `fetchCoffeeRow`.
  2. Read the current row and treat it as a no-op when the value, confidence and canonical basis are equal.
  3. Otherwise `UPDATE … SET superseded_at = now()` on the current row and `INSERT` the new one.
  4. Return `before`.
  - The wrapper `setMatchArchetype` adds `logCatalogChange` and `scopedIntegrity`.
  - Index: `coffee_archetype_assignment_one_current UNIQUE (coffee_id) WHERE superseded_at IS NULL`. `source` is `assignment_source_enum` (cupping/manual/import).
  - `setLeanInTx` copies this shape. `source` becomes TEXT manual/rule per the brief, or a small lookup: G2.7 says no new free-text kind columns, so I'd make it a lookup or a CHECK-free FK. **Flag for you.**
- `quiz_session_interpretation.intensity_lean`: `delicate` 7 rows (all current), NULL otherwise. Confirmed.

### 7. Sellable at coffee grain — **contradicts Rev 3's "nine sellable"**

- `v_coffee_sellable_candidate` is slot-built (`coffee_dial_slot` × `coffee_slot_assignment` × `coffee_slot_price` × SKU).
- **No active coffee has a `coffee_retail_price` row.** The table has 8 rows, all for inactive Path category coffees. Every active coffee's price comes from a slot price.
- By the brief's rule ("`v_coffee_sellable_candidate` says sellable at 12 oz, whatever the price source"), **7 coffees are sellable**: Benchmark, Blossom, Feminista, La Familia, Fabricator, Village, Tiger Stripe.
  - **Geometric is not sellable.** Its home slot "Bright & Tart" (fruity, since the 2026-11-09 move) has no 12 oz price.
  - **Nightcap is not sellable.** It has no slot assignment and no retail price, so no candidate row exists. Its decaf category assignment carries no price.
  - Amsterdam, Big City and The Daily are not sellable, by design.
  - The Village is a sellable candidate but loses the "Clean Fruit" slot to Feminista in `v_coffee_sellable_slot`. Under the candidate rule it still counts as sellable.
- Rev 3 sections 6 and 9 assume nine sellable coffees, including Geometric and Nightcap. On the test DB, the graph check would run on 7. The prod state is not verified (item 10).
- **Tension with the carried decision "the map never reads a slot".** The brief's sellable rule reads `v_coffee_sellable_candidate`, which is built on slots. I'll follow the brief for this brief (CTO call 7 says "whatever the price source") and say so in `inputs_used`. The real coffee-grain rule waits for the commerce move in README finding 1.
- **Stock:** inventory columns on `coffee_sku` are deprecated (drop-ship). The only availability lever is `coffee_sku.is_active`. Proposed `in_stock` = an active 12 oz SKU exists. All 12 have one.

### 8. Parameters and the admin card

- **`param(key)` is a SQL function, not a TypeScript helper** (`schema.sql:3092`, `STABLE`, current row by key). It returns **NULL silently for a missing key**, so a missing `dial_` key would make the preview's rings NULL rather than fail. That is why the B5 integrity check matters.
- `evidenceParameterService.setParameterInTx` (`evidenceParameterService.ts:65`) only edits seeded keys. It parses the range from the note with a strict regex: `Range: [integer|numeric] <lo> <=|< value <=|< <hi>`.
  - **The brief's "Range 0–15" form would not parse.** The key would show on the card but not be editable.
  - The seed notes must say, for example, `Range: numeric 0 <= value <= 15.` and `Range: integer 1 <= value <= 6.`
- `GET /api/admin/evidence/parameters` (`routes/evidenceAdmin.ts`, mounted at `/api/admin/evidence`, reads `evidenceReads.getParameters()`) lists every current key and has **no prefix filter**. `EvidenceParametersCard.tsx` takes an `endpoint` prop and has no prefix prop. So B4 adds `?prefix=`, and brief 2 passes `endpoint="/api/admin/evidence/parameters?prefix=dial_"`. The PUT URL would need the prefix stripped (the card builds `${endpoint}/${key}`), so brief 2 needs a separate `listEndpoint` prop or a `prefix` prop.
- There are no `dial_` keys today, so nothing collides. `session_half_life_days` (365) exists and is the recency half-life Rev 3 section 8 mentions.

### 9. Reuse list (G3.9)

- **Pooled read:** `v_coffee_dimension_range` (via `cuppingReads.getAllMergedRanges` / `getMergedRanges`). The views read it directly.
- **Identity and category codes:** `v_coffee` (`category_codes`, `match_archetype`, `roast_level`), `catalogReads.getCoffees` / `getCoffee`.
- **Transactions:** `withTransaction`, `Tx` (`db/client.ts:52`). Catalog writes use `logCatalogChange` and `scopedIntegrity` (`catalogService.ts`).
- **Parameters:** `evidenceParameterService.setParameterInTx`, `evidenceReads.getParameters`, SQL `param()`.
- **Admin auth:** `routes/admin.ts:65` `router.use(requireAdmin)`, and the sub-router pattern `router.use('/catalog', catalogRouter)` (`admin.ts:3179`). The map routes go in a `mapRouter` mounted the same way; `admin.ts` is CRLF, so edit it with the Edit tool.
- **Word to family:** `v_note_mapping_current` → `v_cupping_note_family`. Website presence: `v_evidence_descriptor`.
- **Grade inputs:** `v_cupping_score` + `v_cupping_session_coffee`.
- **Cousin check:** `v_roastery_portal_cousin_hint`. Pairs with both ends in the catalog: Blossom ↔ Tiger Stripe, Fabricator ↔ Geometric, Benchmark ↔ The Daily, Feminista → Village, La Familia ↔ Village. Jerod's set is Fabricator ↔ Geometric and Tiger Stripe ↔ Blossom.
- **Frontend (brief 2):** `LookupSelect` (`components/admin/LookupSelect.tsx`), `EvidenceParametersCard`.

### 10. Production counts (read-only, after Dana allowed it)

12 active coffees (56 total) · 53 current archetype assignments (12 on active coffees) · 10 active coffees with a pooled range on all four dimensions (La Familia and The Daily have no Body) · 19 current `evidence_parameter` rows · last cupping session 42. Items 2 and 7 on prod: the same values and sellable flags as the test DB, except Feminista Body 5.85 (above).

---

## Where Task 0 contradicted the brief, and Dana's decisions (2026-11-10)

I stopped after Task 0 on five points. Dana decided them all; the decisions are in effect in this build.

1. **Portal words:** no writer change. `v_dial_placement_input` splits `roaster_words` on commas, with ordinality. Words are normalised as in `v_evidence_unmapped_words` and mapped through `v_note_mapping_current` (roaster kind) to `v_cupping_note_family`. An unmapped word counts as no family and is listed in `inputs_used`. OT-118: the portal UI should invite one word per note.
2. **Website words:** presence only, with position NULL, counted at `dial_suggest_word_later`; `inputs_used` says "website: presence". Rev 3 section 9, gate item 1 now reads "portal order read by split".
3. **Sellable:** the brief's rule as written (`v_coffee_sellable_candidate` at 12 oz), and acceptance runs on whatever set it gives. `inputs_used` says the rule reads the slot candidate view until the commerce move (OT-120). `in_stock` = an active 12 oz SKU exists.
4. **Pooled values:** the view is the truth and the workbook is history; the differences are listed, not chased. Parameter defaults stay at 4 / 6.5.
5. **Grade defaults:** A = sessions ≥ 3 and cuppers ≥ 2; B unchanged. Control samples count as sessions. Only `%last cup%` is seeded.
6. **Range notes** use the parser's format.
7. **`coffee_lean_assignment.source`** reuses `assignment_source_enum` (manual).
8. **Dark roast set:** lookup `dial_dark_roast_level` (dark, medium-dark).
9. **Lane codes and writer name:** side_a / middle / side_b, and `setLeanInTx`.
10. **Parameters endpoint:** `?prefix=` on `GET /api/admin/evidence/parameters`.
11. **Tiger Stripe's missing basis** stays an `evidenceIntegrity` flag.

---

## What was built

### Part A — Schema
Additive and idempotent. It is in `schema.sql` (block "ELLA'S BLOOM MAP 1", before the grants; the view pre-drops sit with the evidence pre-drops). Every object has its lines in `comments.sql`.

- **Lookups (G2.7):**
  - From the brief: `dial_lane`, `dial_move`, `dial_evidence_grade`, `dial_map_version_status`, `dial_first_match_status`, `dial_provisional_sample_pattern` (`%last cup%`).
  - From Dana's decision 8: `dial_dark_roast_level`.
  - Added by me (deviations 1–2): `dial_reading` and `dial_cupper_scale_weight`.
- **Config:**
  - `dial_seam` (4 rows).
  - `dial_wedge` (5 rows, per the brief's seeds), with three columns added (deviation 3).
- **Decision:** `coffee_lean_assignment` (partial unique current row; writer `catalogService.setLeanInTx`).
- **Versions:** `dial_map_version` (at most one active: a partial unique index on activated-and-not-retired) and `dial_ring_cut`, `dial_size_cut`, `dial_placement`.
  - The guard trigger `dial_version_row_guard` makes cuts and placements insert-only, and only while the version is a draft.
  - `dial_map_version_guard` lets only the status and its two dates change, and refuses deletes.
  - Grants: the request pool loses UPDATE/DELETE on these tables, and keeps only `superseded_at` on the decision and phrase tables.
- **First match and phrases:** `dial_first_match` (seeded balanced_sweet × side_a → Benchmark 2905, founder pick, by name; it reports when the name is missing) and `dial_hop_phrase` (8 neutral seed rows; an override's NULL line or phrase falls back to the default row).
- **Parameters:** 25 `evidence_parameter` keys `dial_*`, all in the parser's Range format and all editable on the card, with the brief's defaults and Dana's grade A values (sessions 3, cuppers 2).
- **Views:**
  - `v_dial_coffee_availability` (the one sellable / in-stock rule)
  - `v_dial_placement_input`
  - `v_dial_placement_preview`
  - `v_dial_placement`
  - `v_dial_point` (preview and active points, one set per mode)
  - `v_dial_edge_preview` / `v_dial_edge` and `v_dial_hop_preview` / `v_dial_hop`, over the SQL functions `dial_edge_rows(mode)` / `dial_hop_rows(mode)` (deviation 4)
  - `v_dial_face`
  - No view body has a literal threshold: the preview reads `param()`, and the active edges read the version's own parameter snapshot.

### Part B — Backend
- **B1 `services/dialReads.ts`** (the one read path): `placementPreview`, `placementActive`, `edgesPreview`, `edges`, `hopsPreview`, `hops`, `face`, `versions`, `wedges`, `firstMatches` (with the grade-floor check at read time), `phrases` (raw rows plus the resolved family × move words), `parametersInForce`, `graphCheck(mode)`.
  - The graph check is the pure function `computeGraphCheck`: BFS from the center over bolder/gentler/different hop-set edges, never siblings. It returns the reachable set, the unreachable sellable coffees, the reachable set without tagged targets, the lists with no bolder / no gentler / no different / no live direction, and the cousin pairs.
  - It reuses `roasteryPortalReads.listCousinHints` and `evidenceReads.getParameters`.
- **B2 `services/dialPlacementService.ts`** (the one writer):
  - `cutVersion` / `cutVersionInTx` is idempotent on the label, including a concurrent cut (`ON CONFLICT (label) DO NOTHING`, then re-select). It refuses missing parameters and cuts that are out of order.
  - `activateVersion` / `InTx` refuses a non-draft version (409).
  - Also `setWedge`, `setFirstMatch` / `InTx` and `setHopPhrase` / `InTx`, which supersede and treat an unchanged value as a no-op.
- **B3 `catalogService.setLeanInTx` / `setLean`:** the same supersede shape as `setMatchArchetypeInTx` (no-op on the same lane, basis and notes). It stores the preview's suggestion at that moment; `setLean` logs `catalog_change`.
- **B4 `routes/mapAdmin.ts`,** mounted in `admin.ts` at `/map` behind its `requireAdmin`; zod; routes call one function each. The brief's ten GETs and six writes. `GET /api/admin/evidence/parameters?prefix=` (validated `^[a-z0-9_]{1,40}$`; `evidenceReads.getParameters(prefix, runner)`).
- **B5 `dataCatalogIntegrity` checks 7–10** (report only, System Health like the rest):
  - 7: at most one active version, with its status matching its dates.
  - 8: every active-version placement is on an active coffee.
  - 9: lookup seeds present, a wedge per map family, a weight per cupping scale.
  - 10: all 25 `dial_` keys present.

### Part C — none (brief 2).

### Part D — Tests
- **`services/dialMap.test.ts` (10, all pass)** runs inside rolled-back transactions; real coffees are set inactive in the transaction so ranks are the fixture's own. It covers:
  - ring banding at, under and over each cut, the center at 0, no ruler value → not placeable, and the near-cut flag;
  - lean: middle plus a flag with no decision; a decision beats the suggestion; `setLean` twice supersedes once; the stored suggestion equals the preview's;
  - portal order read by split;
  - grade A / B / C / D, provisional, and a half cupper (1.5);
  - the five-placement edge fixture: relations both ways, adjacency 0 / 1 / 2, distance over shared readings only;
  - hops: cap, grade floor, an absent direction, `graphCheck`;
  - `computeGraphCheck`: siblings never connect, the untagged run, cousins;
  - `cutVersion` twice gives one version; activate leaves one active; the trigger refuses update, delete and insert-after-draft;
  - a `dial_ring_cut_1` change moves the preview, not the active version.
- **`routes/mapAdmin.test.ts` (3, pass):** every GET, the phrase fallback, bad input → 400, and the prefix list equals the 25 keys.
- **`dataCatalogIntegrity.test.ts`** now expects 10 checks, with 9 and 10 clean.

## Acceptance (test mode, test DB, as it is; brief 9's dispute is not on it)

**Parameters in force:** dial_cap_different 3, dial_cut_margin_flag 0.25, dial_grade_cuppers_for_a 2, dial_grade_cuppers_for_b 2, dial_grade_sessions_for_a 3, dial_grade_sessions_for_b 2, dial_lean_promotion_n 12, dial_min_grade_rank_first_match 3, dial_min_grade_rank_hop_target 2, dial_ring_cut_1 4, dial_ring_cut_2 6.5, dial_size_cut_1 4.5, dial_size_cut_2 6.5, dial_suggest_body_cut_base 6, dial_suggest_body_cut_light 4, dial_suggest_dark_roast_add 0.5, dial_suggest_threshold 0.25, dial_suggest_w_body 0.3, dial_suggest_word_later 0.5, dial_suggest_word_pos1 1, dial_suggest_w_words 0.5, dial_w_body 0.15, dial_w_lane 0.5, dial_w_ring 1, dial_w_sweet 0.1.

**The preview, every catalog coffee** (no lean decision exists yet, so every lane used is middle; "Suggestion" gives the rule's lane with side A / side B scores and their wedges):

| Coffee | Family | Ruler | Ring | Lane used (decision) | Suggestion (A / B) | Size (sweet) | Grade (sess, cuppers) | Sellable | Flags |
|---|---|---|---|---|---|---|---|---|---|
| Amsterdam | chocolate_nutty | 5.89 | 2 | middle (none) | middle (0 fruity / 0 earthy) | 2 (5.2) | B (2, 2) | no | no_lean_decision |
| Blossom Dark Roast | chocolate_nutty | 6.81 | 3 | middle (none) | middle (0.5 fruity / 0.5 earthy) | 1 (3.11) | B (2, 2) | yes | no_lean_decision |
| Fabricator House Roast | chocolate_nutty | 3.8 | 1 | middle (none) | side_a (0.5 fruity / 0 earthy) | 2 (5.06) | B (2, 2) | yes | ruler_near_cut, no_lean_decision |
| The Daily | chocolate_nutty | 5 | 2 | middle (none) | middle (0 fruity / 0 earthy) | 3 (7.5) | C (1, 1) | no | no_lean_decision |
| Tiger Stripe Espresso | chocolate_nutty | 3.5 | 1 | middle (none) | side_a (0.5 fruity / 0 earthy) | 1 (3.5) | B (1, 2) | yes | no_lean_decision |
| Benchmark | balanced_sweet | center | 0 | middle (none) | side_a (0.72 chocolate_nutty / 0 fruity) | 3 (6.57) | B (2, 2) | yes | no_lean_decision |
| Cafè Feminista: Montze Olvera | fruity | 8.04 | 3 | middle (none) | side_a (0.69 chocolate_nutty / 0 floral) | 3 (8.31) | B (2, 2) | yes | no_lean_decision |
| Geometric Filter Coffee | fruity | 4.66 | 2 | middle (none) | side_a (0.38 chocolate_nutty / 0 floral) | 3 (7.04) | A (3, 2) | no | no_lean_decision |
| Nightcap Decaf | fruity | 7 | 3 | middle (none) | side_a (1 chocolate_nutty / 0 floral) | 2 (6) | D (1, 1) | no | no_family_word, no_lean_decision, provisional |
| The Village | fruity | 4.38 | 2 | middle (none) | side_b (0.38 chocolate_nutty / 1 floral) | 2 (6) | B (2, 2) | yes | no_lean_decision |
| Big City | earthy | 8.61 | 3 | middle (none) | side_a (0.69 chocolate_nutty / 0 floral) | 1 (4.39) | B (2, 2) | no | no_family_word, no_lean_decision |
| Colombia La Familia Guarnizo | floral | 5 | 2 | middle (none) | side_a (0.5 fruity / 0 earthy) | 3 (8.5) | C (1, 1) | yes | no_family_word, no_lean_decision |

**Beside Rev 3 section 6** (the nine coffees Rev 3 called sellable):

| Coffee | Rev 3 cell, grade | Preview cell, grade | Difference and cause |
|---|---|---|---|
| Benchmark | Balanced · 0 · chocolate · 2, B | 0 · middle (suggests chocolate 0.72) · 3, B | Lean: no decision recorded yet (the suggestion agrees with Rev 3). Size 3: pooled Sweetness 6.57, against 5 in the workbook |
| Tiger Stripe | C&N · 1 · fruit · 1, A | 1 · middle (suggests fruit) · 1, B | Lean: no decision. Grade: one session (s37, 2 cuppers); A needs 3 sessions |
| Fabricator | C&N · 1 · middle · 1, B | 1 · middle (suggests fruit) · 2, B | Dana's middle call is not recorded as a decision yet. Size 2: Sweetness 5.06. Flag `ruler_near_cut` (3.80 vs 4) |
| Blossom | C&N · 3 · middle · 1, B | 3 · middle (suggests middle) · 1, B | none |
| Geometric | Fruity · 1 · chocolate · 3, B | **2** · middle (suggests chocolate) · 3, **A**, **not sellable** | Ring: pooled acidity 4.66 against 3 in the workbook (s42 added). Grade A: 3 sessions. Not sellable: its fruity slot has no 12 oz price, so it has no edges |
| The Village | Fruity · 2 · floral · 2, C | 2 · middle (suggests floral, 1.0) · 2, **B** | Lean: no decision (the suggestion agrees). Grade: s42 added Camila (2 sessions) |
| Cafè Feminista | Fruity · 2 · chocolate · 3, C | **3** · middle (suggests chocolate) · 3, **B** | Ring: acidity 8.04 against 6.5 in the workbook (s42). Grade: 2 sessions. Body 6.77 on test (5.85 on prod; the suggestion stays chocolate: 0.66 on prod's values) |
| Nightcap Decaf | Fruity · 3 · chocolate · 2, D | 3 · middle (suggests chocolate) · 2, D, **not sellable** | Not sellable (no slot, no price). Flags `no_family_word`, `provisional` |
| La Familia | Floral · 2 · fruit · 3, C | 2 · middle (suggests fruit) · 3, C | Lean: no decision (the suggestion agrees). Flag `no_family_word` (Rev 3 finding 4) |

**Where the differences come from:**
- **Leans:** no lean decision exists. Every suggestion agrees with Rev 3's call except Fabricator's, where Dana's middle call is waiting to be recorded.
- **Rings:** two move, Geometric and Feminista, because the pooled values are newer than the workbook.
- **Grades:** three move, because of session 42 and the A rule.
- **Sellable:** two coffees are not sellable today, Geometric and Nightcap.
- **No per-coffee override exists anywhere.**

**Hop set (preview, filters off; "edge" = no target in that direction):**

| From | bolder | gentler | different (ranked, within cap) | siblings |
|---|---|---|---|---|
| Benchmark | edge | edge | Fabricator House Roast (1.35), Tiger Stripe Espresso (1.68), Colombia La Familia Guarnizo (2.19) | edge |
| Blossom Dark Roast | edge | Tiger Stripe Espresso (2.25) | Cafè Feminista: Montze Olvera (0.76), The Village (1.6), Colombia La Familia Guarnizo (1.54) | edge |
| Cafè Feminista: Montze Olvera | edge | The Village (1.3) | Blossom Dark Roast (0.76), Colombia La Familia Guarnizo (1.02), Fabricator House Roast (2.47) | edge |
| Colombia La Familia Guarnizo | edge | Benchmark (2.19) | The Village (0.25), Cafè Feminista: Montze Olvera (1.02), Fabricator House Roast (1.34) | edge |
| Fabricator House Roast | Blossom Dark Roast (2.58) | Benchmark (1.35) | The Village (1.17), Cafè Feminista: Montze Olvera (2.47), Colombia La Familia Guarnizo (1.34) | Tiger Stripe Espresso (0.34) |
| The Village | Cafè Feminista: Montze Olvera (1.3) | Benchmark (2.33) | Colombia La Familia Guarnizo (0.25), Fabricator House Roast (1.17), Tiger Stripe Espresso (1.35) | edge |
| Tiger Stripe Espresso | Blossom Dark Roast (2.25) | Benchmark (1.68) | The Village (1.35), Cafè Feminista: Montze Olvera (2.52), Colombia La Familia Guarnizo (1.5) | Fabricator House Roast (0.34) |

**`graphCheck(preview)`**, with the parameters above:
- Center: Benchmark.
- 7 sellable, **7 of 7 reachable**; no unreachable sellable coffee; the same 7 without tagged targets.
- No bolder: Benchmark, Blossom, Feminista, La Familia.
- No gentler: none (the center excluded).
- No different: none. No live direction: none.
- **Cousin pairs:**
  - Tiger Stripe ↔ Blossom: reproduced (bolder / gentler).
  - Feminista ↔ Village: reproduced (gentler / bolder).
  - Village ↔ La Familia: reproduced (different both ways).
  - Fabricator ↔ Geometric: **not reproduced, because Geometric is not sellable**, so it has no edges.
  - The Daily ↔ Benchmark: **not reproduced, because The Daily is not sold**.
- **Benchmark's missing bolder** is the lean: the center's bolder is its lean-side wedge, and it has no lean decision. With Dana's chocolate call recorded, Fabricator / Tiger Stripe become its bolder.

**Dry-run cut (test DB):** cutVersion: {"versionId":10,"label":"test-dry-run","created":true,"placements":12} 
- A second call returns the same version and writes nothing.
- Ring cuts are (–, 4) (4, 6.5) (6.5, –); size cuts are (–, 4.5) (4.5, 6.5) (6.5, –).
- It is left as a draft; nothing is activated.

**Lints and tests:**
- `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping` and `lint:lineage` are all clean, and every new writer is declared. `tsc --noEmit` is clean.
- **Full vitest:** the run collected the stale compiled `dist/` copies too (203 files, two copies racing on one test DB). The `src` failures are the OT-117 baseline (evidenceViews 6, evidenceAdmin 3, quizScoring 6, sommelierEval 2, sommelierRag 2, sommelierAnswer, catalogService, schema.catalog_blueprint, lintCustomer), plus timeouts from the race.
  - The timed-out files (coffeePresentation2, householdService) pass when run on their own.
  - One real failure was mine: `comments.format` (the `evidence_parameter` table comment went over 1000 characters with my Readers addition). Fixed; the file passes.
  - Tests 2208 passed / 68 failed in that doubled run.

## Deviations from the brief, and why
1. **`dial_reading` (new lookup):** the views need to know which `coffee_dimensions` row is acidity, bitterness, body and sweetness. A dimension id in a view body is a mapping in code (G2.1/G7), so it lives in a seeded lookup.
2. **`dial_cupper_scale_weight` (new lookup):** "a non-ab_0_15 cupper counts half" is a mapping too; seeded from `cupping_scale` (ab_0_15 1, others 0.5). Boot check 9 reports a scale without a row.
3. **`dial_wedge` gained `seam_family_note_id`, `seam_uses_body`, `seam_uses_dark_roast`:** the lean suggestion needs to know which word family pulls a coffee toward each wedge (Rev 2 section 4 seam evidence), and the flags need "a family word" and "a chocolate word". `coffee_archetype.descriptor_families` is the catalog's list (C&N includes Sweet), not the seam's, so it does not fit. Rev 3's `dial_seam_evidence` table is folded into these columns.
4. **Edge and hop rule in two SQL functions:** `dial_edge_rows(mode)` and `dial_hop_rows(mode)` sit under the four views. As plain views, the self-join recomputed the preview per side: the hop view took about 90 s on the test DB. With the input materialised once and one function per mode, it takes about 0.3 s, and the rule still lives once. The brief's two-views-per-object shape stands. Two dev-only union views (`v_dial_edge_all`, `v_dial_hop_all`) existed briefly on the test DB; their `DROP IF EXISTS` lines stay in the pre-drops.
5. **`v_dial_coffee_availability` and `v_dial_point` (extra views):** one sellable rule for the preview and the active version, and one point set for the edges.
6. **Hop views keep every eligible target ranked,** with `in_hop_set` (rank 1 for bolder/gentler, `within_cap` for different, all siblings). The brief's "nearest one" alone would leave `matchService` (brief 3) nothing to fall back to after the customer's decaf or stock filter. The view is still unfiltered, as the brief says.
7. **A center with lane middle has no bolder:** the brief says bolder from the center is the wedge on its lean side, so with no decision there is no lean side. This is the brief's rule, not a deviation; I flag it because acceptance shows it.
8. **Provisional = any scored sample of the coffee matches a pattern** (the brief's "D when provisional"). A later non-provisional session does not lift the D. Flag for Dana if it should.

## What brief 2 needs
- **API:**
  - `GET /api/admin/map/preview`: rows with `coffee_id`, `coffee_name`, `archetype_code`, `is_center`, `is_placeable`, `ring`, `size`, `ruler_value`, `acidity` / `bitterness` / `body` / `sweetness`, `lane_code`, `decided_lane_code`, `suggested_lane_code`, `suggested_scores` (`side_a` / `side_b`: archetype, score, words, body), `grade_code`, `grade_rank`, `n_sessions`, `n_cuppers`, `is_sellable`, `in_stock`, `category_codes`, `flags[]` and `inputs_used`.
  - `PATCH /api/admin/map/lean/:coffeeId {lane, basis?, notes?}` → `{result: {coffeeId, unchanged, leanAssignmentId}}`.
  - `GET /map/hops?mode=preview&coffeeId=` → rows with `relation`, `rank`, `in_hop_set`, `within_cap`, `distance` and the deltas.
  - `GET /map/graph-check?mode=` → the shape above.
  - `GET /map/versions` → `ring_cuts` and `size_cuts` per version; `POST /map/versions {label, reason}` → 201 created / 200 existing; `POST /map/versions/:id/activate`.
  - `GET /map/wedges` → `{wedges, seams}`; `GET /map/phrases` → `{rows, resolved}`; `GET /map/first-match` with `meets_grade_floor_*`.
- **Parameters card:** `GET /api/admin/evidence/parameters?prefix=dial_` lists the 25 keys. `EvidenceParametersCard` builds its PUT URL as `${endpoint}/${key}`, so brief 2 needs a separate list URL (or a `prefix` prop) for the card.
- **Data:**
  - Dana records the lean decisions first, at least Benchmark's (chocolate) and Fabricator's (middle). Until then every lane is middle and the center has no bolder.
  - Refresh the test DB first (OT-121).
  - Geometric (unpriced slot) and Nightcap (no slot) are out of the graph until they are priced.
- **Test-DB state left behind:** draft version `test-dry-run` (id 10, 12 placements) on `axisandbloom_test`. Production has no version.
