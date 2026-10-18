# Cupping Evidence v3: the sketch, the tables, the views, who writes and who reads

> 2026-10-17. Companion to `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` (what changed and why). This file is the inventory; the same content with the flow diagram is published as the artifact "Cupping Evidence v3".

## The flow

```
SOURCES                    WRITERS (one each)        EVIDENCE (insert-only)             RECONCILE (views only)            DECIDE (catalog)
Paper sheets, Score Entry → cuppingService         → cupping_sessions                 → v_cupping_scores_readable      → Calibration workbench (Dana)
  Dana, Camila, controls      saveCupperScore          cupping_session_coffees            v_coffee_dimension_range (latest)    ↓
  8.5 g / 150 g               mergeByRule              cupping_brew_params                v_coffee_dimension_history         catalogService (one door)
                              saveBrewParams           cupping_scores                     v_roastery_remark                    ↓
                              refreshDialSignal ──┐    cupping_score_values               v_roastery_portal_current_response  coffee_archetype_assignment
Roaster portal form       → roasteryPortalService  │   cupping_score_descriptors          v_collaborative_flavor_wheel        coffee_slot_assignment
                                                   │ → roastery_portal_* (existing)         (merged current only)             roastery_coffee_descriptors
Table, email, website     → roasteryRemarkService  │ → roastery_remark                    v_evidence_dimension                 basis jsonb · *_from_session_id
Customers                 → customer writer        │ → customer_feedback_*                v_evidence_descriptor                ↓
                                                   └ → dial_position_signal (derived)     v_evidence_archetype               Customer reads: flavor wheel,
                                                       only when all rows ab_0_15         v_evidence_roastery_calibration    Bloom dial, sommelier, beat
                                                                                          v_evidence_cupper_calibration      engine. Decision layer only.
                                                                                          v_evidence_coverage
                                                                                          v_evidence_unmapped_words
                                                                                          cupping_to_ab()  param()
REFERENCE (rows, not code; looked up by writers, loaders and views):
cupper · cupping_scale, cupping_scale_step · cupping_sheet_format, cupping_sheet_line · coffee_dimensions · cupping_note (SCA, tiers 1 2 3) ·
roastery_portal_note_mapping (+source_kind) · evidence_parameter · evidence_stop_word · cupper_calibration_offset (empty)
Feedback edge: catalogService.setMatchArchetype → cuppingService.refreshDialSignal (an archetype change recomputes the signal).
```

## Reference tables

| Table | Holds | Written by | Read by | Brief |
|---|---|---|---|---|
| `cupper` | Who cups: name, active, since. `cupping_scores.cupper_id` points here; `is_merged` is the only merged flag, no sentinel name. | Seed; later an admin door in `cuppingService` | `cuppingService`, Score Entry, every `v_evidence_*` | 1 |
| `cupping_scale`, `cupping_scale_step` | Scales a cupper can use (`ab_0_15`, `grid_0_5`, `word_3`, `legacy`) and each step's 0 to 15 span. | Seed | `cupping_to_ab()`, Score Entry, the loader | 1 |
| `cupping_sheet_format`, `cupping_sheet_line` | Printed sheet versions; which dimension each line feeds. The 9-dim sheet is an INSERT. | Seed | Loader, Score Entry | 1 |
| `coffee_dimensions` | The 12 dimensions; 1, 2, 3 numeric from v3. | Seed (existing) | Everything | 1 |
| `cupping_note` | The SCA wheel as published, all three tiers, `tier` column. A word is stored at the most specific SCA node it names and never deeper: "berries" is Berry (tier 2). | Seed (existing + tier backfill + tier-1/2 nodes) | Descriptors, mappings, wheel view, `v_evidence_descriptor` | 1 |
| `roastery_portal_note_mapping` | Roaster and cupper words → SCA node, `source_kind`; superseded, never deleted. The one home for translation. | `roasteryPortalService.setNoteMapping` | Loader (refuses an unmapped convention), `v_evidence_descriptor`, `v_evidence_unmapped_words` | 1, 2 |
| `evidence_parameter` | Thresholds with history: cupper gap, rank gap, Spearman min n, rho cut, calibration min n. | Seed; direct SQL with supersede | `param(key)` in the `v_evidence_*` views | 1, 3 |
| `evidence_stop_word` | Words the unmapped view ignores. | Seed | `v_evidence_unmapped_words` | 1, 3 |
| `cupper_calibration_offset` | Per cupper × dimension correction, basis, history. Empty until n reaches `param('calibration_min_n')`. | None yet | `v_coffee_dimension_range_calibrated` (unread) | 1 |

## Evidence tables (insert-only; one supersede transition per row, cupper and merged alike; FKs RESTRICT; triggers raise; grants revoked)

| Table | Holds | Written by | Read by | Brief |
|---|---|---|---|---|
| `cupping_sessions` | Date + `session_date_precision`, blind, roaster present, sheet format, record source files, `transcribed_by / transcribed_at / checked_by`. | `cuppingService.createSession`, `updateSessionHeader` | `v_cupping_session`, `v_cupping_scores_readable` | 1 |
| `cupping_session_coffees` | Order, roast date, blind code, sample note, `is_control`. | `cuppingService.addSessionCoffee`, `updateSessionCoffee` | `v_cupping_session_coffee`, range views | 1 |
| `cupping_brew_params` | Dose, water, ratio, temperature, grind, steep, device. 8.5 g / 150 g standard; unrecorded fields null. | `cuppingService.saveBrewParams` | `v_cupping_session_coffee` | 1, 2 |
| `cupping_scores` | One row per cupper per session coffee + one merged row: `cupper_id` / `is_merged`, `scale_code`, calls, merge rule and note, supersede columns. One current row per key (partial unique index). | `cuppingService.saveCupperScore`, `mergeByRule`, `saveManualMerge`; supersede only inside these | `v_cupping_scores_readable`, range and history views, wheel view | 1 |
| `cupping_score_values` | Per dimension: value on the scale used, `raw_value` (the paper, strikes named), `notes` (words, struck as `~word`). | Same, same transaction | Same, through `cupping_to_ab()` | 1 |
| `cupping_score_descriptors` | SCA node at the tier used, her words in `custom_notes`. Never from a struck word. | Same | Wheel view (current merged only), `v_evidence_descriptor` | 1 |
| `roastery_portal_response` + `_note`, `_dimension`, `_brew`, `_lineup_response` | What the roaster typed, immutable per version. | `roasteryPortalService` (existing) | `v_roastery_portal_current_response` | — |
| `roastery_remark` | Roaster words outside the form, verbatim, channel, topic, `supersedes_id`. | `roasteryRemarkService.recordRemarks` | `v_roastery_remark` | 1, 2 |
| `customer_feedback_event`, `customer_feedback_descriptor` | Customer words tied to an order; weight 0 for the dial. | Existing customer writer | Wheel view, `v_evidence_descriptor`, `v_evidence_coverage` | — |
| `dial_position_signal` | Derived cupping signal per archetype × dominant dimension; only when every contributing row is `ab_0_15`. | `dialSuggestion.recordCuppingSignal`, only via `cuppingService.refreshDialSignal` (after merge, after the loader's manifest, on archetype change) | `v_coffee_dial_position_consensus` | 1 |

## Decision tables (supersede, never delete; `catalogService` only)

| Table | Holds | Written by | Read by | Brief |
|---|---|---|---|---|
| `coffee_archetype_assignment` | Archetype, confidence, source, `assigned_from_session_id`, `notes` (basis text), `basis jsonb`. | `catalogService.setMatchArchetype` | `v_coffee`, `v_evidence_archetype` | 1 column, 4 writes |
| `coffee_slot_assignment` | Slot, role, priority, placement note, `placed_from_session_id`, `basis jsonb`, certification. | `catalogService.placeCoffee`, `move`, `certifyPlacement` | `v_coffee_slot`, `v_evidence_archetype` | 1 column, 4 writes |
| `roastery_coffee_descriptors`, `roastery_portal_acceptance` | Roaster descriptors accepted into the catalog. | `catalogService` via `acceptResponse` | Wheel view (roastery branch), `v_evidence_descriptor` | — |

## Views and functions (nothing stored; no view writes)

| View | One row per | Answers | Read by | Brief |
|---|---|---|---|---|
| `cupping_to_ab()` | function | Native value + `scale_code` → 0 to 15 span, from `cupping_scale_step`. | Readable and range views | 1 |
| `param()` | function | Current value of an `evidence_parameter` key. | `v_evidence_*` | 1 |
| `v_cupping_session`, `v_cupping_session_coffee` | session; session coffee | Score Entry lists: cupper names, brew params, control flag, current merged score id. | `cuppingReads` | 1 |
| `v_cupping_scores_readable` | current score row × dimension | Every current cupper and merged row, converted, with calls, scale, blind, roaster present. | `cuppingReads`, evidence views | 1 |
| `v_coffee_dimension_range` | coffee × dimension | The **latest** current merged range, session id and date, `n_sessions`, `all_ab_scale`. What the dial and D6 read. | `cuppingReads` → dial suggestion, brew card, coffees routes | 1 |
| `v_coffee_dimension_history` | coffee × dimension × session | Every session's current merged range. Repeatability and calibration read this. | Calibration views | 1, 3 |
| `v_coffee_dimension_range_calibrated` | coffee × dimension | Range with offsets applied. Unread until Dana says. | Nothing yet | 1 |
| `v_collaborative_flavor_wheel`, `v_coffee_descriptor` | observation; coffee × descriptor | Internal = current merged descriptors only, with tier; roaster = accepted; client = feedback. The customer-facing wheel. | Public flavor-wheel route, sommelier, beat engine, orders, catalog integrity | 1 |
| `v_roastery_remark` | remark | Every remark with names, wheel node, `is_current`. | `roasteryRemarkReads`, evidence views | 1 |
| `v_evidence_dimension` | coffee × dimension × cupper | Her range, merged range, roaster 1 to 5 and rank, flags from `param()`. | `evidenceReads` | 3 |
| `v_evidence_descriptor` | coffee × SCA family | Who named the family: each cupper, form, remark, website, customer; accepted; hit / miss / extra. | `evidenceReads` | 3 |
| `v_evidence_archetype` | coffee | Every call, roaster proposals, catalog answer and basis, D6 band check, `evidence_newer_than_decision`. | `evidenceReads` | 3 |
| `v_evidence_roastery_calibration` | roastery × dimension | Rank correlation (average-rank ties), mean rank gap, inverted when n allows, archetype crosstab, descriptor counts. | `evidenceReads` | 3 |
| `v_evidence_cupper_calibration` | cupper × dimension × blind | Gap to each other cupper, to roaster rank, to the catalog on controls, repeatability across sessions. | `evidenceReads` | 3 |
| `v_evidence_coverage` | coffee | Sources present, `n_sources`, basis present, `flag_unreconciled`. | `evidenceReads`, System Health | 3 |
| `v_evidence_unmapped_words` | word × source | Words with no SCA node, minus stop words. The mapping queue. | `evidenceReads` | 3 |

## Writers and readers (TS), each proven by a lint

| Module | Writes | Reads | Called from | Lint |
|---|---|---|---|---|
| `cuppingService` | The six `cupping_*` tables; the dial signal via `refreshDialSignal` | Own base tables, in transactions | Score Entry routes, the brief 2 loader, `catalogService.setMatchArchetype` (signal refresh) | `lint:cupping` |
| `cuppingReads` | — | `v_cupping_*`, `v_coffee_dimension_*`, `v_coffee_descriptor` | Score Entry, `dialSuggestion`, `brewCard`, `routes/coffees` | `lint:cupping` |
| `evidenceReads` | — | The seven `v_evidence_*` | Coffees page evidence panel, Roastery Feedback → Calibration tab and workbench, System Health | `lint:cupping` (sole reader of `v_evidence_`) |
| `roasteryRemarkService` / `Reads` | `roastery_remark` | `v_roastery_remark` | `/api/admin/roastery-remarks`, the loader | `lint:roastery-portal` |
| `roasteryPortalService` / `Reads` | `roastery_portal_*`, `roastery_portal_note_mapping` | `v_roastery_portal_*` | Portal, Roastery Feedback, the loader (mappings) | `lint:roastery-portal` |
| `catalogService` / `catalogReads` | The three decision tables, with `basis` and session ids | `v_coffee`, `v_coffee_slot`, the wheel view | Calibration workbench, Coffees and Bloom Dial dialogs, import manifest | `lint:catalog` |
| Customer writer (existing) | `customer_feedback_*` | — | Feedback and wheel flows | existing |

## The six rules the structure enforces
1. **Stored as observed.** Values on the scale used, the paper in `raw_value`, words at the SCA tier used. Conversion and family roll-up happen in reads.
2. **Never updated, once superseded.** One transition per `cupping_scores` row; deletes raise; FKs restrict.
3. **A strike is not a mark.** Crossed-out marks are never counted and are named in `raw_value`; struck words stay as `~word` and never become descriptor rows.
4. **Latest session, history kept.** The catalog reads the latest merged range; calibration reads every session; a decision pins its session; the views say when newer evidence exists.
5. **Flags are never gates.** No view writes the catalog. The basis is composed from the rows on screen, stored as text and JSON.
6. **Nothing hard-coded.** Cuppers, scales, sheets, thresholds, stop words and word mappings are rows; comparison views are one row per cupper.

## Conceptual entity diagram (entities, not columns)

```
MASTER            REFERENCE                                   VOCABULARY HUBS
ROASTER ─1─*─ COFFEE (hub) ─1─*─ CUSTOMER?        SHEET FORMAT  CUPPER  SCALE  PARAMETER·STOP WORD (no FK)

EVIDENCE
  CUPPING SESSION ─1─*─ SESSION COFFEE ─1─1─ BREW PARAMS
        ↑ sheet format            │ coffee
                                  └─1─*─ SCORE (0..1 cupper; null when merged; scale used; supersedes → SCORE)
                                            ├─1─*─ SCORE VALUE ──→ DIMENSION
                                            └─1─*─ SCORE DESCRIPTOR ──→ FLAVOR NOTE (SCA, tier 1 2 3, parent tier → FLAVOR NOTE)
  ROASTER ─1─*─ PORTAL COFFEE (lineup, → coffee?) ─1─*─ PORTAL RESPONSE ─1─*─ PORTAL NOTE ──→ WORD MAPPING ──→ FLAVOR NOTE
  ROASTER ─1─*─ REMARK (→ coffee?, → session coffee?, → flavor note?, supersedes → REMARK)
  CUSTOMER ─1─*─ FEEDBACK EVENT (→ coffee, order) ─1─*─ FEEDBACK DESCRIPTOR ──→ FLAVOR NOTE
  DIAL SIGNAL (derived: coffee × archetype × dimension)
  CALIBRATION OFFSET (cupper × dimension, empty)

DECISION (each → COFFEE, each with a basis)
  ARCHETYPE ASSIGNMENT → ARCHETYPE, → CUPPING SESSION (assigned_from)
  SLOT ASSIGNMENT → DIAL SLOT (→ ARCHETYPE), → CUPPING SESSION (placed_from)
  ROASTER DESCRIPTOR → FLAVOR NOTE
```
The Coffee is the hub. Evidence hangs off it from four directions and never points into the decision row; the decision entities point at the Coffee, at the session they were decided from, and at the vocabulary. Flavor Note and Dimension are the vocabulary every source resolves to.

## Naming (decided 2026-10-17)

Domain word first, as everywhere else in the database: `cupping_` stays, nothing is renamed; `Class:` in `comments.sql` carries the layer (master / fact / operating / view). New tables are singular (`cupping_scale`, `cupping_sheet_line`, `cupper`), like every table since the catalog blueprint; the existing plural six keep their names. `evidence_parameter` and `evidence_stop_word` stay, next to the `v_evidence_*` views they serve.

## Known alignment issues (found in the code; each has a home)

| # | Where | What meets what | Resolution | Brief |
|---|---|---|---|---|
| 1 | `routes/admin.ts` Score Entry (9 DML, 16 base reads) | Today a score is an upsert (`ON CONFLICT (session_coffee_id, taster_name) DO UPDATE`, values upserted, descriptors deleted and re-inserted). v3 forbids all three. | Re-saving a cupper row supersedes the current one (`supersede_reason = 'edited in Score Entry'`) and inserts the new; UX stays "save again". Drop `CUPPING_CUPPER_ROW_EXISTS`. Unique constraint → partial index in the same deploy as the route change. | 1 |
| 2 | `comments.sql` 591 to 642, `lineage.json` | `Writer:` for the six cupping tables names `admin.POST …` routes; `cupping_brew_params` says `none`. `lint:lineage` fails CI once `cuppingService` writes them. | Rewrite the six `Writer:` fields to `cuppingService.*` in the same commit as Part B; name `lint:lineage` as the fifth lint. | 1 |
| 3 | `catalogService` ~200, D6 `descriptor_off_family` | Counts top-3 families over `v_collaborative_flavor_wheel` (today: cupper rows + merged + superseded + accepted + customer). After A1 the internal branch is merged-current only; the top three can change. | Until brief 3: merged-current + accepted + customer. After brief 3: read `v_evidence_descriptor` (`named_by_ab OR named_by_roaster`). Flag, never gate. | 1, 3 |
| 4 | `routes/orders.ts` feedback form | `SELECT DISTINCT cupping_note_id FROM v_collaborative_flavor_wheel` builds the notes a customer can tick; after A1 and tier-2 nodes it is decision-layer words only and may include "Berry". | Intended; say so in the closing report. | 1 |
| 5 | `dial_position_signal` (writers: `dialPositionSignal`, `dialSuggestion.recordCuppingSignal`, `orders` supersede-only) | `refreshDialSignal` adds a supersede-when-not-native path; a new writer module trips lineage. | The retract path lives inside `dialSuggestion.recordCuppingSignal` (a `retract` option); `cuppingService` only calls it. | 1 |
| 6 | `roasteryPortalReads` 821 | Reads `v_coffee_dimension_range` (`value_min, value_max, n_scores, basis`); the view becomes latest-session. | Column names kept; the portal shows the latest session. Rule: base tables only by their service; views open to any `*Reads`; only `v_evidence_*` confined to `evidenceReads`. | 1 |
| 7 | `routes/coffees.ts` (11 base reads, public API) | Product endpoints read cupping base tables; after brief 1 they read the latest-session view through `cuppingReads`; multi-session coffees change from union to latest. | Intended, customer-visible; one sentence in the closing report. Today only Flying Jewel and the Path seed coffees could be affected. | 1 |
| 8 | `coffees.flavor_descriptors_roaster` | Two homes for one decision: `acceptResponse` writes both `roastery_coffee_descriptors` and this array; `catalogImport` writes it; `catalogReads` exposes it while the wheel reads the accepted table. | Outside briefs 1 to 4: derive it in `v_coffee` from `roastery_coffee_descriptors`, mark `Class: deprecated`, stop writing. Brief 2 passes `[]`. | later |
| 9 | The brief 2 loader | A new module; any DML in it trips `lint:lineage` and `lint:cupping`. | Calls `cuppingService`, `roasteryRemarkService`, `roasteryPortalService.setNoteMapping`, `catalogImport` only. Repeat as a constraint line. | 2 |
| 10 | `v_coffee_dial_position_consensus`, `v_archetype_vectors`, `beatEngine`, `sommelierRag`, `routes/cron.ts` | Downstream readers of the wheel view and the dial consensus; none reads a base table. | Nothing to change; closing report confirms each still returns rows on prod. | 1 |

## How it fits the rest of the system

| Domain | Write door | Reads over views | Lint in CI | Integrity (report-only) | Since |
|---|---|---|---|---|---|
| Catalog | `catalogService` (+ `catalogImport`) | `catalogReads` | `lint:catalog` | `catalogIntegrity` | Catalog Blueprint 2026-09 |
| Customer | `customerFacts` | `customerReads`, `palateReads` | `lint:customer`, `lint:retention` | `customerIntegrity` | Customer Blueprint 2026-09 |
| Roastery portal | `roasteryPortalService` | `roasteryPortalReads` | `lint:roastery-portal` | in the service | Portal parts 1 to 7 |
| Quiz | `quizSession`, `quizScoring` | views | — | `quizIntegrity` | Quiz V7 |
| **Cupping evidence** | `cuppingService`, `roasteryRemarkService` | `cuppingReads`, `evidenceReads` | `lint:cupping` (+ remark rules in `lint:roastery-portal`) | `evidenceIntegrity`: every evidence table commented with its writer; no current merged row without cupper rows; no superseded row without replacement; no placed coffee without a basis. System Health card. | v3 |
| Everything else | routes still write (`admin`, `coffees`, `users`, `auth`, `cron`, `newsletter`); tolerated by `lint:lineage` because `comments.sql` names them; each gets a door with its blueprint | | | | |

| Cross-cutting rule | What it is | How cupping evidence uses it |
|---|---|---|
| One writer per table (`lint:lineage`) | `Writer:` in `comments.sql` lists allowed modules; CI fails otherwise | One service per evidence table; decision tables keep `catalogService`; `dial_position_signal` adds `cuppingService.refreshDialSignal` |
| `Class:` | master, fact, operating, snapshot, view, deprecated; `CATALOG.md` groups by it | Reference = master; evidence = fact; decision = operating; reconcile = view. The three layers are the existing taxonomy |
| `Readers:` | Who reads each object | Filled for every new object; boot check reports gaps |
| Reads over views | Services read base tables in their own transactions; everyone else through a `*Reads` module | `cuppingReads` (Score Entry, dial), `evidenceReads` (sole reader of reconcile views); public flavor-wheel route reads the wheel view, now decision layer only |
| Supersede patterns | `superseded_at` + partial unique index; or `supersedes_id` on the new row | Scores: first. Remarks: second. No third |
| Immutability | Triggers raise; grants revoked from `ab_app` | Same shape on the six cupping tables and the remark table |
| Two times | Business time and system time | `session_date` + `created_at`; `said_on` + `load_dts` |
| Signals and the dial | Every source writes `dial_position_signal` with a weight; the consensus view combines | Cupping stays one source; refreshed from the latest merged row, native scale only |
| Catalog governance | Read `CATALOG.md`, say why nothing fits, comment, regenerate | Each reference table replaces a literal in code; `roastery_remark`'s reason in design §3 |
