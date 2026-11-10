# Claude Code brief — Ella's Bloom Map 1: Schema, rules, preview

Workstream: ella_bloom_map (`README.md` here; the design is `misc/palate_model/BLOOM_DIAL_HUB_MODEL_REV3_2026-11-09.md`, read sections 2 to 6, 8 and 9 first) · Written 2026-11-10 by the CTO session · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** No money, no email, no customer surface in this brief.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `evidence_parameter` keys prefixed `dial_`; vocabularies: `dial_lane`, `dial_move`, `dial_evidence_grade`, `dial_map_version_status`, `dial_first_match_status`, `dial_provisional_sample_pattern`) · G2.2 surrogate id PK · G2.3 prefixes `dial_` (the map: new domain, stated here) and `coffee_` (a catalog decision) · G2.4 CATALOG.md checked (why nothing fits: no object holds a per-coffee ring, lane or size, a map version, a pairwise coffee relation, or a lean decision; `coffee_dial_slot` is a ladder per archetype, not a cell, and is read by subscriptions) · G2.5 one writer (`dialPlacementService` for every `dial_` table; `catalogService.setLeanInTx` for `coffee_lean_assignment`), reads via `v_dial_*` and `dialReads` · G2.7 lookups · G2.8 idempotent schema, seeds insert if missing · G2.12 evidence insert-only, decision a separate layer · G2.17 comments.sql → catalog:md · G3.1 routes call services · G3.3 idempotent · G3.9 reuse (`param`, `evidenceParameterService.setParameterInTx`, `catalogService.setMatchArchetypeInTx` as the pattern, `cuppingReads`, `v_coffee_dimension_range`) · G5.1 vitest · G1.6 push is deploy, one closing report.
STOP point: after Task 0 only. Boot seeds the new lookups and parameter rows in production at deploy, as every brief's seeds do; nothing else writes production.

**Goal.** The map exists as data: every catalog coffee gets its four reads (family from the existing archetype decision, ring, lean from a new decision table with the rule's suggestion beside it, size) and an evidence grade through a preview view over current evidence; pairwise edges and hops are computed views over the preview and over a cut version; a version can be cut and activated by one service; admin API serves all of it. At the end the preview is printed for every catalog coffee beside Rev 3 section 6 in the closing report. No customer surface reads any of it yet.

**Decisions already made (Dana 2026-11-10, Rev 3 section 10; do not re-open).** R3.1 acidity is the fruit side's ruler, bitterness the chocolate side's, one band set for the whole map set at the cut (start 4 / 6.5), never tertiles · R3.2 lean is a workbench decision with the rule as suggestion, promoted later · R3.3 hops are directional nearest neighbour over pairwise edges; the cell is a drawing position only · R3.4 moves are stay, bolder, gentler, different (sibling internal); sweetness is not a move · R3.5 evidence grade per placement; first match needs B, hop target needs C · R3.6 tagged coffees (decaf) are targets only under the matching filter · R3.7 position stays on a coffee that left the catalog; substitute = nearest sibling · R3.8 quiz secondary orders "different" from the center · R3.9 trail drawn on the active version · R3.10 button labels and move lines are family × move phrases. Carried: the map and the match never read a slot or `coffee_hop`; tap only.
CTO calls for this brief, reversible, flag if the code disagrees:
1. Map parameters live in `evidence_parameter` under keys prefixed `dial_`, read through `param(key)`, with a Range in the note. No new parameter table.
2. The family stays `archetype_enum` codes; the center is `balanced_sweet`; `experimental` has no placement (`coffee_archetype.is_archetype = false`).
3. Per-wedge map config is a new `dial_wedge` row (ruler dimension, the wedge on each side, angle order, is_center), because `dial_archetype_config` is dropped and `coffee_archetype.dominant_dimension_id` is the quiz's fact, not the map's.
4. Lean semantics: a wedge has side A and side B (the neighbouring wedges); lane is side_a / middle / side_b. For the center side A is `chocolate_nutty`, side B is `fruity`. Seams are the pairs of neighbouring wedges and get labels for the face in `dial_seam`.
5. Two views per computed object: `*_preview` over current evidence (workbench only) and the plain view over the active version (customer readers, brief 3). The graph check is a TS function over the preview edges, not SQL.
6. Build evidence (parsed blend components) does not exist; the lean suggestion is the mean over words and body only, as Rev 2 section 4 allows. `dial_base_origin` is not created in this brief (nothing reads it).
7. The grade's "provisional" signal is `cupping_session_coffees.sample_note` matched against a small seeded pattern table, plus a cupper row with `scale_code <> 'ab_0_15'` counting as half a cupper for the thresholds. Thresholds are parameters.

---

## Task 0 — Verify (write into `CLOSING_REPORT_1.md` before changing anything; STOP after)

1. **CATALOG.md check** for every object in Part A: none exists under any name; `dial_archetype_config` is dropped (schema.sql ~2727) and `coffee_archetype` owns `has_bloom_dial`, `is_archetype`, `dominant_dimension_id`. List `coffee_dimensions` ids and codes for bitterness, acidity, body, sweetness (the note says 7 chocolate_nutty, 5 balanced and fruity, 9 floral, 6 earthy; confirm which id is which dimension).
2. **Pooled values.** `v_coffee_dimension_range` columns (midpoint, min, max, `n_sessions_pooled`, `session_weights`, `sessions_disagree`), scale 0 to 15, how a missing dimension shows (no row or NULL). Print the midpoint of the four dimensions for the eighteen Joe Bean and Joe Coffee coffees and compare with the Placement sheet of `misc/palate_model/HUB_PLACEMENT_PREVIEW_JOE_2026-11-09.xlsx` (columns J to M); list every difference. Note which coffees have no Body (The Daily, La Familia expected).
3. **Words with position.** `roastery_portal_response_note.rank` on the current submitted responses for Joe Bean's lineup: is rank 1 on every note (the Rev 2 "portal rank bug") or does it carry the roaster's order? If every note is rank 1, find where `roasteryPortalService.saveDraft` loses the order and whether the portal UI sends one; report, do not fix in this brief unless it is a one-line fix in the writer (then fix it and say so). Website words: `roastery_coffee_descriptors` (does it keep order; `v_coffee_descriptor`). Mapping to a tier-1 family: `v_note_mapping_current`, `v_cupping_note_family`, `v_evidence_descriptor` (which already resolves Nutty/Cocoa, Fruity, Floral, Roasted per coffee per source). Decide which existing view gives "first position of a family word per source" and reuse it; if none does, say what `v_dial_placement_input` must compute.
4. **Roast level.** Where a coffee's roast level lives today (portal response dimension, `coffees`, `v_roastery_portal_coffee`), and whether Amsterdam carries conflicting values across sources (the preview flagged it).
5. **Cupping rows for the grade.** Per coffee: current merged row, distinct sessions, distinct cuppers with their `scale_code`, `cupping_session_coffees.sample_note` values present in the DB (list the distinct notes; "last cup of the day" expected), `is_control`. Confirm `v_cupping_score` gives this without a new base read.
6. **Family and lean today.** `coffee_archetype_assignment` current rows for the eighteen coffees; `experimental` live coffees; `catalogService.setMatchArchetypeInTx` signature and its supersede pattern (partial unique on `superseded_at IS NULL`, `basis` jsonb, `source`), to copy for `setLeanInTx`. `quiz_session_interpretation.intensity_lean` values in use (delicate only).
7. **Sellable at coffee grain.** What `v_coffee_sellable_candidate` says per coffee (active, SKU, price source); whether a coffee with a slot price and no `coffee_retail_price` row counts as priced. For this brief `is_sellable` in the preview = `v_coffee_sellable_candidate` says sellable at 12 oz, whatever the price source; write down the rule you used. Stock: which column says in stock today (`coffee_sku`, inventory).
8. **Parameters and admin card.** `param(key)` helper location and signature; `evidenceParameterService.setParameterInTx` range enforcement; whether `EvidenceParametersCard.tsx` can list keys by prefix (brief 2 needs it).
9. **Reuse list** (G3.9): `cuppingReads` pooled read, `catalogReads.getCoffees` / `v_coffee` for identity and category codes, `catalogService` transaction helpers, `routes/admin.ts` auth pattern, `LookupSelect`.
10. **Production, read-only:** count of active coffees, of current archetype assignments, of coffees with a pooled range on all four dimensions, of `evidence_parameter` current rows.

## Task 0.5 — Dana's manual steps
None.

---

## Part A — Schema (additive, idempotent; `comments.sql` for every object; `catalog:md`)

Lookups (G2.7; `id SERIAL PK, code TEXT UNIQUE, label TEXT`, plus the columns named):
- `dial_lane`: side_a, middle, side_b. `customer_label` NULL (never shown).
- `dial_move`: quiz_result, stay, bolder, gentler, different, liam, sibling; `is_customer_move BOOLEAN` (true for stay, bolder, gentler, different); `sort_order`.
- `dial_evidence_grade`: A, B, C, D; `rank SMALLINT` (4, 3, 2, 1); `description`.
- `dial_map_version_status`: draft, active, retired.
- `dial_first_match_status`: founder_pick, derived.
- `dial_provisional_sample_pattern`: `pattern TEXT UNIQUE` (ILIKE pattern), seeded `%last cup%`.

Config tables:
- `dial_seam`: `archetype_a archetype_enum, archetype_b archetype_enum, label TEXT, is_labelled BOOLEAN`, UNIQUE (archetype_a, archetype_b). Seeds: (chocolate_nutty, fruity) "fruit on chocolate"; (chocolate_nutty, earthy) "deeper roast"; (fruity, floral) "delicate"; (earthy, floral) unlabelled.
- `dial_wedge`: `archetype_code archetype_enum UNIQUE REFERENCES coffee_archetype(code)`, `is_center BOOLEAN`, `angle_order SMALLINT` (top-right 1 chocolate_nutty, top-left 2 fruity, bottom-right 3 earthy, bottom-left 4 floral, center 0), `ruler_dimension_id INT NULL REFERENCES coffee_dimensions(id)` (bitterness for chocolate_nutty and earthy, acidity for fruity and floral, NULL for the center), `side_a_archetype archetype_enum`, `side_b_archetype archetype_enum`. Seeds per Rev 3 section 2 and CTO call 4: chocolate_nutty A fruity B earthy; earthy A chocolate_nutty B floral; fruity A chocolate_nutty B floral; floral A fruity B earthy; balanced_sweet A chocolate_nutty B fruity. Writer: seed, admin edits through `dialPlacementService.setWedge`.

Decision table (`coffee_` domain, sister of `coffee_archetype_assignment`):
- `coffee_lean_assignment`: `id SERIAL, coffee_id INT REFERENCES coffees(id) ON DELETE RESTRICT, lane_id INT REFERENCES dial_lane(id), suggested_lane_id INT NULL, suggested_scores JSONB NULL` (side A score, side B score, inputs used), `basis JSONB NULL, notes TEXT NULL, source TEXT NOT NULL` (manual | rule), `decided_by TEXT NULL, created_at TIMESTAMPTZ, superseded_at TIMESTAMPTZ NULL`; partial UNIQUE (coffee_id) WHERE superseded_at IS NULL. Writer `catalogService.setLeanInTx` (supersede the current row, insert the new one, same transaction shape as `setMatchArchetypeInTx`).

Version and placement:
- `dial_map_version`: `id SERIAL, label TEXT UNIQUE, status_id INT REFERENCES dial_map_version_status(id), reason TEXT, parameters JSONB NOT NULL` (every `dial_` parameter value in force at the cut), `cut_by TEXT, cut_at TIMESTAMPTZ, activated_at TIMESTAMPTZ NULL, retired_at TIMESTAMPTZ NULL`; partial UNIQUE index on status active (exactly one active).
- `dial_ring_cut`: `version_id INT REFERENCES dial_map_version(id), ring SMALLINT CHECK 1..3, lo NUMERIC, hi NUMERIC`, UNIQUE (version_id, ring). One set per version (R3.1).
- `dial_size_cut`: same shape with `size`.
- `dial_placement`: `version_id, coffee_id, archetype_code, is_center BOOLEAN, ring SMALLINT CHECK 0..3, lane_id, size SMALLINT CHECK 1..3, ruler_dimension_id INT NULL, ruler_value NUMERIC NULL, acidity NUMERIC NULL, bitterness NUMERIC NULL, body NUMERIC NULL, sweetness NUMERIC NULL, lean_assignment_id INT NULL REFERENCES coffee_lean_assignment(id), suggested_lane_id INT NULL, suggested_scores JSONB NULL, grade_id INT REFERENCES dial_evidence_grade(id), n_sessions SMALLINT, n_cuppers NUMERIC, is_sellable_at_cut BOOLEAN, inputs_used JSONB, flags TEXT[]`, UNIQUE (version_id, coffee_id). Insert-only per version; a version is never edited after activation (enforce: `dialPlacementService` refuses writes to a non-draft version).
- `dial_first_match`: `archetype_code, lane_id, coffee_id, status_id, notes, created_at, superseded_at`; partial UNIQUE (archetype_code, lane_id) current. Seeds: balanced_sweet × side_a → Benchmark as `founder_pick` (by coffee name lookup at seed time; if the name is not found, seed nothing and report). Other rows: none seeded; the workbench fills them (brief 2).
- `dial_hop_phrase`: `archetype_code archetype_enum NULL` (NULL = default for every family), `move_id, button_label TEXT, move_line_template TEXT` (placeholders `{from}`, `{to}`, `{deltas}`), `edge_phrase TEXT NULL, created_at, superseded_at`; partial UNIQUE (archetype_code, move_id) current. Seeds (neutral, Rev 3 section 7): defaults for stay "Same again", bolder "Bolder", gentler "Gentler", different "Something different", edge phrase "You're at the edge of the map here"; fruity and floral overrides bolder "Brighter", gentler "Softer"; move line templates "Bolder than {from}: {deltas}", "Gentler than {from}: {deltas}", "A different direction from {from}: {deltas}".

Parameters (`evidence_parameter` rows, inserted if the key is missing, each note ending with its Range): `dial_ring_cut_1` 4 (Range 0–15), `dial_ring_cut_2` 6.5 (0–15), `dial_size_cut_1` 4.5, `dial_size_cut_2` 6.5, `dial_cut_margin_flag` 0.25 (0–2), `dial_w_ring` 1, `dial_w_body` 0.15, `dial_w_sweet` 0.10, `dial_w_lane` 0.5 (each 0–5), `dial_cap_different` 3 (1–6), `dial_min_grade_rank_first_match` 3 (1–4), `dial_min_grade_rank_hop_target` 2 (1–4), `dial_grade_sessions_for_b` 2, `dial_grade_cuppers_for_b` 2, `dial_grade_sessions_for_a` 2, `dial_grade_cuppers_for_a` 3 (each 1–10), `dial_lean_promotion_n` 12 (1–100), `dial_suggest_w_words` 0.5, `dial_suggest_w_body` 0.3, `dial_suggest_body_cut_light` 4, `dial_suggest_body_cut_base` 6, `dial_suggest_word_pos1` 1, `dial_suggest_word_later` 0.5, `dial_suggest_dark_roast_add` 0.5, `dial_suggest_threshold` 0.25.

Views (bodies read every number from `evidence_parameter` current rows and the lookups; no literal threshold in a view, G7):
- `v_dial_placement_input`: one row per active coffee with `is_archetype = true` family: archetype code and `dial_wedge` row; pooled midpoints of the four dimensions from `v_coffee_dimension_range` (NULL when absent) with `n_sessions_pooled`; sessions and cuppers behind the merged rows (Task 0 item 5) and whether any sample note matches a provisional pattern; first position of a Nutty/Cocoa, Fruity, Floral and Roasted family word per source (portal rank, website order) through the view Task 0 item 3 chose; roast level and a dark flag; `is_sellable` and `in_stock` per Task 0 item 7; category codes (decaf etc. from `v_coffee`).
- `v_dial_placement_preview`: the rules over the input with the current parameters: `ring` (center 0; else the ruler against cut 1 / cut 2), `size`, lean decision (current `coffee_lean_assignment` row, NULL when none), the suggestion (side A score vs side B score per Rev 2 section 4, words and body only, mean over readings present, snapped by `dial_suggest_threshold`), `grade` (A if sessions ≥ a and cuppers ≥ a; B if sessions ≥ b or cuppers ≥ b; else C; D when provisional or no merged row), `is_placeable` (has family, has a ruler value or is center), `flags` (Rev 3 section 2: center coffee whose ruler value would be ring ≥ 2 on either ruler; no family word in any source; ruler value within the margin of a cut; chocolate-side coffee with no chocolate word; suggestion ≠ decision; no lean decision), `inputs_used`. The lane used downstream is the decision when it exists, else middle with the flag.
- `v_dial_placement`: `dial_placement` rows of the active version joined to `v_coffee` identity, current `is_sellable`, `in_stock`, category codes.
- `v_dial_edge_preview` and `v_dial_edge`: every ordered pair of placeable (preview) or placed (active) coffees that are both sellable, with `relation` (a `dial_move` code per Rev 3 section 4: same family higher ring bolder, lower gentler, same ring sibling; from the center, side A wedge bolder else different; to the center gentler; otherwise different), `distance` (w_ring·|Δring| + w_body·|Δbody| + w_sweet·|Δsweetness| + w_lane·[lane differs], over readings both have), `delta_ring, delta_body, delta_sweetness, delta_acidity, delta_bitterness`, `adjacency_rank` for different (0 the wedge on the lean side, 1 the other neighbouring wedge, 2 opposite; from the center every wedge is 1), `to_grade_rank`, `to_category_codes`.
- `v_dial_hop_preview` and `v_dial_hop`: per from-coffee: the nearest `bolder`, the nearest `gentler`, the `different` rows ranked by (adjacency_rank, distance) numbered 1..n, every `sibling` ranked by distance; only targets with grade rank ≥ `dial_min_grade_rank_hop_target`; unfiltered by category (brief 3's `matchService` applies the customer's filters and the cap).
- `v_dial_face`: active version, every placed coffee: coffee id and name, archetype code, is_center, ring, lane code, size, is_sellable, in_stock, category codes, grade code (admin reads only; brief 3's customer API strips grade).

---

## Part B — Backend

B1 **`dialReads`** (new read module, the one read path): `placementPreview()`, `placementActive()`, `edgesPreview()`, `edges()`, `hopsPreview(coffeeId?)`, `hops(coffeeId?)`, `face()`, `versions()`, `wedges()`, `firstMatches()`, `phrases()`, `graphCheck(mode: preview | active)`: BFS from the center coffee(s) over bolder/gentler/different edges (siblings excluded), returning reachable set, unreachable sellable coffees, coffees with no bolder, no gentler, no different, and a roaster cousin check: for every `v_roastery_portal_cousin_hint` pair with both ends placed, whether either direction appears in the other's hop set (Jerod's pairs are the test set).

B2 **`dialPlacementService`** (the one writer of every `dial_` table): `cutVersion({ label, reason, adminUid })`: in one transaction insert the version as draft with the parameter snapshot, copy `v_dial_placement_preview` rows where `is_placeable` into `dial_placement` (grade, suggestion, decision id, flags, `is_sellable_at_cut`), copy the current cut parameters into `dial_ring_cut` and `dial_size_cut`; idempotent on `label` (a second call with the same label returns the existing version, writes nothing). `activateVersion(id)`: retires the active one, activates this one, in one transaction; refuses a version that is not draft. `setWedge`, `setFirstMatch` (supersede pattern), `setHopPhrase` (supersede pattern). Nothing in this service updates a placement row.

B3 **`catalogService.setLeanInTx(client, coffeeId, laneCode, { basis, notes, decidedBy })`**: reads the current suggestion from `v_dial_placement_preview` and stores it on the row; supersedes the current decision; `source = manual`. Exposed as `setLean` with its own transaction.

B4 **Admin routes** (`routes/admin.ts`, admin role server-side, zod, routes call services): `GET /api/admin/map/preview`, `/map/placement`, `/map/edges?mode=`, `/map/hops?mode=&coffeeId=`, `/map/face`, `/map/graph-check?mode=`, `/map/versions`, `/map/wedges`, `/map/first-match`, `/map/phrases`; `POST /map/versions` (cut), `POST /map/versions/:id/activate`, `PATCH /map/lean/:coffeeId`, `PATCH /map/wedges/:archetype`, `PUT /map/first-match`, `PUT /map/phrases`. Parameters go through the existing evidence-parameter endpoints (prefix filter `dial_` if the endpoint lists keys; add a `prefix` query if it does not).

B5 **Integrity (report, never block, G2.18):** `dataCatalogIntegrity` gains: exactly one active version or none; every active-version placement's coffee still active; a lookup seed missing; a `dial_` parameter key missing. Shown on System Health as the others are.

---

## Part C — Frontend
None in this brief (brief 2 builds the workbench on the API above).

---

## Part D — Tests (vitest, test DB)

1. Ring banding: values at, just under and just over each cut land in the right ring; center is always 0; a missing ruler value gives no placement and the right flag.
2. Lean: with no decision the preview lane is middle with a flag; a decision beats the suggestion; `setLean` twice supersedes once (one current row); the suggestion stored on the decision equals the preview's suggestion at that moment.
3. Grade: fixtures for A, B, C, D including the provisional pattern and a non-0-15 cupper counting half.
4. Edge relations: a fixture of five placements (center, two in one wedge at rings 1 and 3, one in a neighbouring wedge at ring 1, one in the opposite wedge) yields the Rev 3 section 4 relations in both directions; distance uses only shared readings; `adjacency_rank` ordering.
5. Hops: cap and grade floor respected; a direction with no candidate is absent (the edge state is the absence); `graphCheck` reports reachability and dead ends on the fixture.
6. `cutVersion` twice with the same label: one version, one placement set; `activateVersion` leaves exactly one active; a placement row cannot be updated through the service.
7. Parameters: changing `dial_ring_cut_1` through `setParameterInTx` changes the preview's rings and does not change an active version's placements.

---

## Acceptance (test mode, local backend, test DB; evidence in `CLOSING_REPORT_1.md`)

- The preview printed for every catalog coffee (sellable or not): coffee, family, ruler value and ring, lane decision and suggestion with both scores, size, grade with sessions and cuppers, flags, `is_sellable`, beside the Rev 3 section 6 table for the nine Joe coffees. Every difference listed with its cause (a pooled value differing from the workbook, a missing word source, a rule reading). No per-coffee override anywhere.
- `graphCheck(preview)` output: reachable set, dead ends, cousin pairs reproduced, with the cuts and weights in force.
- `cutVersion` run once on the test DB as a dry run, label `test-dry-run`, left as draft; nothing activated.
- Lints green (`lint:lineage` with every new writer declared), `tsc --noEmit`, `vitest run`; deploy green; startup log clean with the new integrity lines.

## Docs and closing (G6)
`WHAT_WE_BUILT.md` entry naming this brief; `WHAT_WE_BUILT_DB.md` "As of" line; `comments.sql` for every table, view and column with Writer and Readers, `catalog:md`, `CATALOG.md` committed; `OPEN_TASKS.md`: the portal rank fix if not done here, the build parser, the subscriptions-on-slots move (from `README.md`); `REGRESSION.md`: one active version at most, placement rows never updated, the preview changes with parameters and the active version does not; `CLOSING_REPORT_1.md` with Task 0 findings, the printed preview, deviations, what brief 2 needs (any API shape it should know).

## Do not
- Do not alter, drop or re-seed any existing table, view, enum or `coffee_archetype_assignment` row; do not touch slots, `coffee_hop`, `dialSuggestion.ts`, subscriptions or any customer route.
- Do not put a cut, weight, cap or grade threshold in code or a view body; do not type a coffee name into code (the one seed lookup by name is in the first-match seed and reports when it misses).
- Do not override a coffee's ring, size or grade by hand; the only per-coffee decisions are the existing archetype row and the new lean row, each with a basis.
- Do not build the workbench page, the customer page or `matchService`; those are briefs 2 and 3.
- Do not open a PR or hand Dana manual steps.
