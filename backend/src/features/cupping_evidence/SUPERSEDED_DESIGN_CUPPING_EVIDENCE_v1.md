> **SUPERSEDED 2026-10-16, never executed.** Replaced by the v2 series in `backend/src/features/cupping_evidence/` (DESIGN_CUPPING_EVIDENCE.md + briefs 1, 2, 3). Kept for history only. Do not run.

# Cupping Evidence: how our cupping notes and roastery data enter the database

> Folder: `backend/src/features/cupping_evidence/` · Written 2026-10-16 (CTO session, decisions by Dana) · Status: DESIGN, briefs to follow
> Companion: `backend/src/features/cupping_joe_coffee/CLAUDE_CODE_PROMPT_CUPPING_JOE_COFFEE_1.md` (the first load, written 2026-10-13, not yet run)
> Source material: `misc/roasteries/Utopian/CUPPING_NOTES.md`, `misc/roasteries/Joe Bean/Cupping 1 - Sep 2026/CUPPING_NOTES_Joe_Bean_2026-09-30.md`, `misc/roasteries/Joe Coffee/Cupping Oct 2, 2026/CUPPING_NOTES_Joe_Coffee_2026-10-02.md`, `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx`

## 1. The problem in one paragraph

We (Dana, Camila) cup every coffee we might sell and write scores, descriptors and an archetype call. Roasteries tell us about the same coffees through the portal form, at the cupping table, by email, and on their websites. We are not trained cuppers, so our numbers and words can be off; roasteries know their beans but classify by bean and reference lineup, not by our families of taste. Nothing from either side should be copied straight into the catalog as the truth. The catalog assignment (archetype, dial slot, leading notes, aftertaste and mouthfeel wording) is an Axis & Bloom decision that must be able to say what evidence it rests on, and the evidence must stay available so the decision can be revisited when there is more data.

## 2. Principle: observe, reconcile, decide

Three layers, each with its own tables, written by one writer each, joined only in views.

| Layer | What it holds | Mutability | Who writes |
|---|---|---|---|
| **Evidence** | One row per observation: who observed, when, through what channel, in their own words and on their own scale | Insert-only (or versioned and immutable once submitted) | Load scripts via the existing services; the portal; later, customers |
| **Reconciliation** | Per coffee and per facet (dimension, descriptor family, archetype, slot): every source lined up, agreement and disagreement flagged | Views only, nothing stored | Nobody; derived |
| **Decision** | The catalog: `coffee_archetype_assignment`, `coffee_slot_assignment`, accepted descriptors, with a written basis | Supersede, never delete (existing discipline) | `catalogService` only (the one write door) |

Flags are never gates. No view and no rule writes the catalog. Dana (and later a data-driven rule, once there is enough data) reads the reconciliation and decides.

## 3. The sources of evidence

| # | Source | What | Where it lives | Scale | State on 2026-10-16 |
|---|---|---|---|---|---|
| E1 | A&B cupping, per cupper | Dimension scores, descriptors, aftertaste and mouthfeel words, archetype call, position call | `cupping_sessions` → `cupping_session_coffees` → `cupping_scores` (one row per taster) → `cupping_score_values` (`value_min`, `value_max`, `notes` per dimension), `cupping_score_descriptors` (wheel leaf + `custom_notes`) | 0 to 15, ranges allowed | Tables exist. Joe Bean (4 blends, both cuppers) and Utopian (10 coffees, both cuppers) not loaded. Joe Coffee (8, Dana) in the unexecuted brief. |
| E2 | A&B cupping, merged | The one row per coffee the dial signal and `v_coffee_dimension_range` read | `cupping_scores` with `is_merged = true` | 0 to 15 | Same tables; the merge is today done by hand in Score Entry |
| E3 | Roaster, portal form | Notes (their words + wheel pick, ranked), 7 dimensions, proposed archetype, brew, availability, lineup answers | `roastery_portal_response` + `_note`, `_dimension`, `_brew`, `_lineup_response` | Dimensions 1 to 5, **relative to the roaster's own lineup** | Submitted: Joe Bean (Kathy Turiano, 2026-10-14), Joe Coffee (Ruby Vishnick, 2026-10-08 and 10-13). Utopian: nothing submitted. |
| E4 | Roaster, outside the form | What they said at the table, by email, on a call | `roastery_remark` (Joe Coffee brief Part A, not yet created) | Words | 38 Joe Coffee rows waiting in the brief |
| E5 | Roaster, website / bag | Bag notes, roast level, process as published | **Same table as E4**, `channel = 'website'` (new value, see §5.4) | Words | Utopian's 10 cupped coffees + 8 uncupped in the intake xlsx; Joe Bean and Joe Coffee site text where the portal prefill came from |
| E6 | Roaster, accepted | Roaster descriptors Dana accepted into the catalog | `roastery_coffee_descriptors` (set semantics, retire never delete), `roastery_portal_acceptance` log | Wheel leaf | Mechanism exists (portal part 2) |
| E7 | Customer | Feedback descriptors, lighter / as expected / bolder, later the collaborative wheel | `customer_feedback_descriptor`, `dial_position_signal` (`client_wheel`, `onsite_feedback`) | Words, 3-point | Tables exist; `client_wheel` weight 0 in `dial_source_weight` |

Translation between vocabularies already has a home: `roastery_portal_note_mapping` (their words → `cupping_note` leaf, remembered, superseded never deleted) and `cupping_note.wheel_category` (leaf → SCA family). All descriptor comparison happens at the family level through these two.

## 4. What exists and what is added

**Exists, reused as is**: every table in §3; `coffee_dial_slot.spec_band_lo/hi` and `spec_descriptor_families` (the D6 check: a placement whose merged cupping range falls outside the slot's band already warns and requires `placement_note`); `coffee_archetype_assignment.assigned_from_session_id` + `notes`; `catalog_change`; `v_collaborative_flavor_wheel`; `v_coffee_dimension_range`; `v_roastery_portal_dimension_match`; `recordCuppingSignal` → `dial_position_signal`.

**Added (small, on existing tables)**:

- `cupping_scores` gains the cupper's blind calls as structured columns: `archetype_call archetype_enum`, `archetype_call_secondary archetype_enum`, `position_call TEXT` (the words as written: "light", "med-strong", "delicate"), `slot_call_id INT REFERENCES coffee_dial_slot(id)` (filled only when the call is unambiguous, e.g. "Bloom dial: light fruity" → fruity/1), `call_note TEXT` ("DEF", "partly crossed out"). Today these calls have no home except free text. Nullable, no backfill of existing rows.
- `roastery_remark.channel` CHECK gains `'website'` (edit to the unexecuted brief, no migration needed).
- `cupping_sessions.session_notes` already exists; every loaded session records the sheet format used and the merge rule applied (§5.3).
- `cupping_scores` gains `superseded_at TIMESTAMPTZ` so a hand re-merge supersedes the rule-merged row instead of editing it (same supersede pattern as `coffee_archetype_assignment`). Readers of the merged row filter `superseded_at IS NULL`.

**Brought under the one-writer / one-reader rule (the cupping tables never were)**. Checked 2026-10-16: the five `cupping_*` tables are written by inline SQL in `routes/admin.ts` (Score Entry endpoints) and read directly from `routes/admin.ts`, `routes/coffees.ts`, `services/brewCard.ts` and `services/dialSuggestion.ts`; five views exist over them but nothing forces readers through them and no lint covers them. Before any load:
- `services/cuppingService.ts` becomes the only writer: `createSession`, `addSessionCoffee`, `saveScore` (per-cupper or merged; values, descriptors and the call columns in one transaction), `mergeByRule(sessionCoffeeId)` (the §5.3 union, in code once), `supersedeMerged`. `saveScore` with `is_merged = true` is the one caller of `recordCuppingSignal`. The admin routes become thin callers; the load scripts in briefs 1 and 2 call the service, not the HTTP route.
- `services/cuppingReads.ts` becomes the only reader of the base tables, over the views: `v_cupping_scores_readable` (extended with the call columns and `superseded_at`), `v_coffee_dimension_range` (merged ranges; `dialSuggestion.getAvgCuppingScore` and `brewCard` move here), `v_coffee_descriptor` (`coffees.ts` moves here). A view missing a column a reader needs gains the column; the base table is never read outside `cuppingService.ts`, `cuppingReads.ts` and `schema.sql`.
- `scripts/lint-cupping.mjs`, same shape as `lint-roastery-portal.mjs`: DML on `cupping_*` only in `cuppingService.ts`; `FROM cupping_*` only in the two files and `schema.sql`; proven with probe files, probes deleted; wired into the same npm lint entry as the others.
- Brief 3's reconciliation views read evidence through the existing views where one fits (`v_coffee_dimension_range`, `v_cupping_scores_readable`, `v_roastery_remark`, `v_roastery_portal_current_response`), not base tables, so a base-table change has one place to propagate.

**Not added**: no new evidence table, no stored reconciliation table, no "confidence score" column computed by a formula. If a later brief proposes a new table it must first say why none of the tables in §3 fits (DB governance rule, 2026-10-13).

## 5. Loading rules (the evidence layer)

### 5.1 Catalog rows first
A cupping row needs a `coffees` row. Every cupped coffee gets one through the import manifest path (`catalogService`, dry run first), **unplaced and without a SKU** unless Dana has already decided to sell it. Unplaced coffees are invisible to customers; they exist so evidence can attach. Lineup rows in `roastery_portal_coffee` are linked to them (`linkLineupCoffeeToCatalog`) so portal submissions can later be accepted onto the right coffee.

### 5.2 One row per cupper, as written
- `taster_name` = 'Dana' / 'Camila', `is_merged = false`.
- Dana's ranges go to `value_min`/`value_max`. A single circled point is `min = max`. Several marks (2, 4, 5, 6, 8) are the span (2 to 8) with the marks listed in `notes`. Crossed-out marks are not counted and are recorded in `notes` as "crossed: 4".
- Camila's points are `min = max`.
- Camila's **word scale** on the Utopian freeform grids (low / medium / high) is converted to a range **and the word is kept in `notes`**: low = 0 to 5, medium = 5 to 10, high = 10 to 15. Her **small integers** on the Mexico / Peru / Colombia grid (0 to 5, relative within that flight) are converted as `value × 3` with a width of 3 (`v×3 − 1` to `v×3 + 1`, clamped to 0 to 15) and the original integer kept in `notes` as "grid 0-5: 5". Both conversions are stated once in the session notes and can be redone later from `notes`.
- Words on free-text dimensions (Fragrance 1, Aroma 2, Flavor 3, Finish Character 11, Mouthfeel 12) go to `cupping_score_values.notes` with null min/max, exactly as written, including struck-through words marked "~".
- Every descriptor that maps to a wheel leaf also goes to `cupping_score_descriptors` with the exact words in `custom_notes`. Words with no leaf (tea-like, whole milk, happy) stay in the dimension notes only.
- Numeric "Mouthfeel light to heavy" = dimension 7 Body; "Aftertaste short to long" = dimension 10 Finish Length (decided 2026-10-11, same as the Joe Coffee brief). La Familia's 9 to 11 mouthfeel is texture, not body: Body unscored, "whole milk" to dimension 12.
- Archetype and position calls go to the new `cupping_scores` columns. A call the cupper did not write stays null; "Nutty / Cocoa family circled, no call" is a descriptor fact, not an archetype call.
- Remarks a roaster made that the cupper wrote on her own sheet are **not** cupper evidence: they go to `roastery_remark` (E4) with `said_by` the roaster's person and `recorded_by` the cupper.

### 5.3 The merged row, by rule
One `is_merged = true` row per coffee per session, created at load:
- Numeric dimension: the **union** of the cuppers' ranges (2 to 8 and 3 → 2 to 8; 7 to 10 and 0 → 0 to 10). Wide is honest: it says what we observed.
- A dimension scored by one cupper only: her range, `notes` says "one cupper".
- Descriptors: the union of both cuppers' leaves.
- Archetype call on the merged row: filled only when both cuppers made the same call; otherwise null and `call_note` lists both.
- `overall_notes`: "merged by rule 2026-10-16: union of ranges; cupper disagreement (> N) on: Acidity, Sweetness".
- Saving the merged row fires `recordCuppingSignal` as Score Entry does. The signal is advisory (`dial_position_signal` never writes positions).
- Dana can re-merge any coffee by hand later in Score Entry; the per-cupper rows are untouched by that.

For a single-cupper session (Joe Coffee, Dana only), her row is the merged row (decision already in the Joe Coffee brief).

### 5.4 Roaster words outside the form
`roastery_remark`, one row per statement, verbatim, DV-shaped (`record_source`, `load_dts`):
- Cupping-table remarks: `channel = 'cupping_table'`, `cupping_session_coffee_id` set.
- Bag / website notes: `channel = 'website'`, `record_source = 'utopiancoffee.com via misc/roasteries/intake/Roaster_Intake_Utopian.xlsx (Sep 2026)'`, `topic = 'descriptor'` one row per note ("Ube Halo Halo"), plus `topic = 'process'` and a roast-level row where published. `cupping_note_id` set when the translation is clear (Honeycomb → Honey), null otherwise; the mapping is also remembered in `roastery_portal_note_mapping` so the same words map the same way next time.
- A roaster's archetype-like statement ("Earth (delicate earth)", "Balanced") is `topic = 'classification'` with `proposed_archetype` set. A proposal, never an assignment.

### 5.5 What is never loaded as evidence
Claude's transcription verdicts in the notes files (`match: close / far`, the "Patterns across the session" section). Those are analysis, and §6 recomputes them from the rows.

## 6. Reconciliation (views, nothing stored)

All in the `v_cupping_*` / `v_coffee_evidence_*` family, created with DROP VIEW + CREATE VIEW, granted to `reporting_ro`, listed in `CATALOG.md`.

### 6.1 `v_coffee_evidence_dimension`: one row per coffee × numeric dimension
Columns: coffee, dimension, `dana_min/max`, `camila_min/max`, `merged_min/max`, `cuppers_agree` (ranges overlap, or the point is within N = 2 of the other's range), `roaster_value_1_5` (latest submitted portal response), `roaster_rank_in_lineup`, `ab_rank_in_lineup` (by merged midpoint, within the same roastery's cupped coffees), `rank_gap`, `roaster_agrees` (`rank_gap` < 2), `flag` (`none` / `cuppers_disagree` / `roaster_disagrees` / `both`).

Why ranks: our scale is 0 to 15 absolute, theirs is 1 to 5 relative to their own lineup. The two are never compared by value (house rule since portal part 1); within one roastery's lineup they can be compared by order.

### 6.2 `v_coffee_evidence_descriptor`: one row per coffee × SCA family
Columns: coffee, family, `named_by_dana`, `named_by_camila`, `named_by_roaster_form`, `named_by_roaster_remark` (table + website), `named_by_customer`, `hit` (we and the roaster both), `miss` (roaster only), `extra` (we only). Built on `v_collaborative_flavor_wheel` + `roastery_remark` + `roastery_portal_response_note`, through the mapping table.

### 6.3 `v_coffee_evidence_archetype`: one row per coffee
Columns: `dana_call`, `camila_call`, `roaster_form_proposal`, `roaster_remark_proposal`, `catalog_match_archetype` (from `v_coffee`), `catalog_home_slot` (from `v_coffee_slot`), `position_calls` (both cuppers' words), `slot_spec_check` (the D6 band result for the current placement), `basis` (from `coffee_archetype_assignment.notes`, §7.3).

### 6.4 `v_roastery_calibration`: one row per roastery × dimension
The data-driven view of "are we off": Spearman rank correlation between our merged midpoints and the roaster's 1 to 5 values across that roastery's lineup, `n`, `mean_rank_gap`, `inverted` (correlation < −0.5: the roaster, or we, read the scale backwards; this is how the suspected Joe Bean inversion becomes a measurement instead of an impression). Plus, per roastery: archetype crosstab counts (our call × their proposal), descriptor hit / miss / extra counts by family. With 4 to 10 coffees per roastery the correlations are indicative, not significant; the view says `n` so nobody over-reads them.

### 6.5 `v_cupper_calibration`: one row per cupper × dimension
Our own drift over time: mean signed gap between the cupper's midpoint and the roaster's rank-implied position, mean range width, count of disagreements with the other cupper. After 20 to 30 coffees with roaster comparisons this is what turns "we are not trained cuppers" into a per-dimension correction we can apply, or decide not to.

## 7. Decision rules (the catalog)

### 7.1 Precedence is per evidence type, not per source
| Facet | Who wins when sources disagree | Why |
|---|---|---|
| Descriptors / leading notes (wheel family) | Roaster (form, then remark, then website) over our cupping | They know their beans; their notes are what the customer reads on the bag |
| Dimension scores | Portal 1 to 5 by rank when given; otherwise our merged range, flagged `one source` | Roasters mostly describe, they don't score; where they scored, their order of their own lineup is reliable |
| Aftertaste / mouthfeel wording | Our cupping words, with the roaster's words beside them | The form does not ask for these in words |
| **Archetype** | **Axis & Bloom only** | Our families of taste are not the roaster's bean families (the Earthy vs Chocolate & Nutty case: we classify roast-driven, they classify bean-driven). Their proposal is evidence, never a vote |
| **Dial slot / position** | **Axis & Bloom only**, checked against `coffee_dial_slot.spec_band` on the merged range | Same reason; plus the slot is a product decision (what sits next to what) |

Our cupping never overrides a roaster's descriptor; it flags. Dana's override path with a note stays available for any facet.

### 7.2 Nothing automatic
No view writes the catalog. `assignCoffee` / `placeCoffee` stay the only doors. The reconciliation views are read on the admin side when Dana decides; the per-coffee basis is written at that moment.

### 7.3 Every decision states its basis
`coffee_archetype_assignment.notes` and `coffee_slot_assignment.placement_note` carry one line in a fixed shape:
`basis: cupping s<id> (Dana=Earthy, Camila=Earthy); roaster form v1 (Kathy)=chocolate_nutty; website=Dark roast, Campfire; rule: A&B family is roast-driven → earthy; slot by body 8-10 → earthy/3`
`assigned_from_session_id` points at the session. §6.3 shows the basis beside the evidence it names, so nothing is copied.

### 7.4 Calibration pass per lineup
Before a lineup goes live, Dana reads `v_coffee_evidence_archetype` and `v_roastery_calibration` for that roastery and confirms or changes each assignment, writing the basis. This is the "calibration effort on all lines of coffees" (Dana, 2026-10-16); it is a pass over a view, not a re-cupping.

### 7.5 Later: data-driven assignment
When enough coffees carry evidence from two or more sources, a rule can propose assignments from the evidence rows (slot by merged range vs spec band, family by descriptor hits). It will be a proposal column in §6.3, never a writer, until Dana decides otherwise. Not built now (no theory-first rules, 2026-09-26).

## 8. Customers and the collaborative wheel (later)
Customer observations are already E7 and already weighted 0 for dial purposes. When the collaborative wheel ships, each submission is one evidence row tied to an order (so we know the coffee and the brew), source `client_wheel`, and appears in §6.2 as `named_by_customer`. The weight stays 0 until the rows show how customer words relate to cupping-bowl words; that is a measurement to make, not a number to pick now.

## 9. Governance
- Every evidence row carries two times: the business time (`session_date`, `said_on`, the portal `submitted_at`) and the system time (`created_at` / `load_dts`). Never one standing in for the other.
- Every evidence row carries its `record_source` (sheet file, portal response id, website + file) so a row can be traced to the paper or page it came from.
- Only the services named here write their tables; `lint:catalog` / `lint-roastery-portal` get the new rules.
- `COMMENT ON` every new column and view; `CATALOG.md` regenerated (data catalog workstream).
- Nothing deleted or dropped. Re-merges supersede; remarks and per-cupper rows are immutable.
- Reports to `WHAT_WE_BUILT_DB.md`: one section "Cupping evidence" pointing here.

## 10. Brief sequence

| # | Brief | Does | Depends on | Model |
|---|---|---|---|---|
| 1 | `cupping_joe_coffee/CLAUDE_CODE_PROMPT_CUPPING_JOE_COFFEE_1.md` (exists, amended) | Extracts `cuppingService` / `cuppingReads`, moves the four direct readers to views, adds `lint-cupping` (§4); creates `roastery_remark` (with `'website'`); adds the §4 columns to `cupping_scores`; Joe Coffee: 8 catalog rows (4 placed), session 2026-10-02 (Dana, merged), 38 remarks, lineup links | nothing | Sonnet |
| 2 | `cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md` | Joe Bean: 4 catalog rows (unplaced), session 2026-09-30, both cuppers + rule-merged, archetype calls; Utopian: 9 catalog rows (unplaced; Flying Jewel exists), session (date from the sheets), both cuppers with §5.2 conversions + rule-merged, 10 coffees × website remarks, lineup links. No placement, no SKU, no archetype change on anything already assigned | 1 | Sonnet |
| 3 | `cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md` | The five views of §6, their tests, `reporting_ro` grants, comments, a read-only admin surface (per-coffee evidence panel on the Coffees page + a Calibration tab under Roastery Feedback), System Health card "coffees with unreconciled flags" | 1, 2 | Sonnet for views; Dana reviews the view definitions before it runs |
| 4 | (later) calibration pass per lineup | Dana's decisions through the existing admin pages, basis lines written; no brief, or a short data brief if she prefers to hand the list to Claude Code | 3 | |

## 11. Open points, with the default the briefs will use unless Dana says otherwise
1. Camila's 0 to 5 grid conversion (`v×3`, width 3). Default stands; originals kept in `notes` so it can be redone.
2. Cupper-vs-cupper threshold N = 2 on the 0 to 15 scale (Dana: start small). Rank gap ≥ 2 for us vs roaster.
3. Utopian session date: the sheets carry no date; the folder photos are from 2026-10-16, the first Utopian cupping was 2026-09-13 (four coffees) and a second flight followed. Brief 2 will record the dates Dana gives; if unknown, the session is dated by the photo and `session_notes` says so.
4. Whether Joe Coffee's and Joe Bean's website text is loaded as `'website'` remarks too (the portal prefill already carries origin / process / roast; only the published tasting notes would be new). Default: yes, same as Utopian, so all three roasteries have the same five sources.

## 12. Why not a Data Vault (decided 2026-10-16)

Asked: should the evidence layer be a Data Vault, or is append-only with dates enough for operational data?

Answer: append-only, source-specific tables with `record_source` and `load_dts`, which is what §3 already is. The Cloud SQL database is the operational system, not a warehouse fed by one. A formal vault (hubs with hash keys, links, one satellite per source with hash diffs) buys integration of many sources with changing schemas and full history at warehouse scale, at the price of every operational read becoming a multi-join. Here the sources are five, the schemas are ours, the volume is tens of coffees and hundreds of observations, and the app already has a governed operational model (one write door, views as the read path).

What the vault habits give that we do want, and already have:
- Hubs: `coffees` and `roaster` are the business keys.
- Links: `cupping_session_coffees` (coffee ↔ session), `roastery_portal_coffee` (coffee ↔ lineup row).
- Satellites: one evidence table per source, never merged across sources (`cupping_*`, `roastery_portal_*`, `roastery_remark`, `customer_feedback_*`). A new source gets a new table, never a column on an existing one.
- Insert-only, `record_source`, `load_dts`, business time kept separate from load time (§9).
- Mutable decision tables use supersede (`superseded_at`), the house SCD pattern, not updates in place.

If an analytical layer is ever wanted (cross-roastery calibration over years, customer palate over time at volume), it belongs in BigQuery fed from these tables (Dataplex is already on the instance), and that is where a vault or a star schema would be modeled. Not now, and not in the operational database.
