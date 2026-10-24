# Cupping evidence (v3)

How Axis & Bloom's own cupping notes, what roasteries tell us, and (later) what customers tell us enter the database without any of it being copied into the catalog as the truth. Observe (insert-only evidence per source, as written, on the scale used), reconcile (views, nothing hard-coded), decide (the catalog, through the one write door, with a written basis).

| File | What |
|---|---|
| `DESIGN_CUPPING_EVIDENCE.md` | The design: v2 text with a **v3** paragraph at the end of each amended section. §0 is v1→v2, §0b is v2→v3. Read first. |
| `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` | Every v3 change with its reason and the brief it lands in; §4 has the defaults for the ambiguous transcription items. |
| `DESIGN_CUPPING_EVIDENCE_v3_SKETCH.md` | The flow, the conceptual entity diagram, every table and view with writer and readers, how it fits the catalog / customer / portal blueprints, the known alignment issues (10). Same content with diagrams: artifact "Cupping Evidence v3". |
| `REVIEW_CUPPING_EVIDENCE_v2_2026-10-16.md` | The review that produced v3 and Dana's answers. History. |
| `TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md` | Blind second read of the 21 sheets vs brief 2: 12 struck marks counted as live, 4 struck words loaded, 1 dropped call note. Brief 2 is corrected from it. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md` | Brief 1 (v3): reference tables (`cupper`, `cupping_scale`, `cupping_sheet_format`, `evidence_parameter`, `evidence_stop_word`, `cupper_calibration_offset`), `cupping_note.tier`, schema columns, one supersede transition, RESTRICT and triggers, `cuppingService` / `cuppingReads` / `refreshDialSignal`, latest-session range + history, wheel view closed to raw rows, `roastery_remark`, lints, `Writer:` rewrite. No data. Run first. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md` | Brief 2 (v3): Joe Coffee, Joe Bean, Utopian, corrected against the transcription check; native-scale values; SCA-tier mappings; brew params; dated flights; provenance; order sessions → merges → manifest → signal; Joe Coffee's and Joe Bean's website notes (captured 2026-10-18) beside Utopian's. Data only. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md` | Brief 3 (v3): the seven `v_evidence_*` views one row per cupper, thresholds from `param()`, history-based calibration with controls and repeatability, `evidence_newer_than_decision`, the D6 family warning moved onto `v_evidence_descriptor`, three read-only admin surfaces. Stops after the views for Dana to read them. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_4_WORKBENCH.md` | Brief 4 (v3): the Calibration workbench; `composeBasis` returns text + JSON, both stored; `placed_from_session_id`; no cupper named in code. No schema, no new writer. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_4b_WORKBENCH_READABILITY.md` | Brief 4b: layout and type fixes to the workbench and the evidence panel from the live page (`workbench_before_2026-10-21.jpg`). No logic. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_5_BALANCE_CUPPING.md` | Brief 5: load the Balance cupping of 2026-10-21 (one cross-roaster session, Dana + Camila, Union / Benchmark / Fabricator / Geometric, all already in the catalog). Data only; second session on four coffees. Checked by `TRANSCRIPTION_CHECK_BRIEF_5_2026-10-21.md`. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_6_POOLED_RANGE_CUSTOMER_VOICE.md` | Brief 6: `v_coffee_dimension_range` becomes a pool over every session weighted by rank (ratio parameter, 60/40 for two) and by time (half-life), both editable from the admin portal; `sessions_disagree` flag; `v_evidence_descriptor_consensus` (k of n sessions per node) for the admin pages; `v_coffee_customer_descriptor`: the customer hears the roaster's words only, with `confirmed_by_cupping` where we agreed. Replaces the v3 latest-session rule. |
| `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_7_EARTHY_CUPPING.md` | Brief 7: load the Earthy / C&N cupping of 2026-10-23 (one cross-roaster session, Dana + Camila, Obsidian / Espresso Volo / Blossom / Amsterdam / Big City, all already in the catalog). Same shape as brief 5. Checked by `TRANSCRIPTION_CHECK_BRIEF_7_2026-10-23.md`. |
| `SUPERSEDED_*` | v1 and v2 of the design and the briefs. Kept for history only; never executed. |

Status 2026-10-18 (later): **brief 3 executed and on prod** (`CLOSING_REPORT_3.md`): the reconciliation views (`v_evidence_*`, read only through `services/evidenceReads.ts`, lint:cupping rule 4), `services/evidenceIntegrity.ts` (8 report-only checks, boot + System Health), the D6 family warning on `v_evidence_descriptor`, and three read-only admin surfaces (Coffees page Evidence panel, Roastery Feedback → Calibration, System Health "Cupping evidence"). Catalog tests no longer touch live slots (`src/test/freeSlots.ts`). Brief 4 (the workbench) not started.

Status 2026-10-18 (late): **brief 4 executed** (`CLOSING_REPORT_4.md`): the Calibration workbench under Roastery Feedback (queue, the brief 3 evidence tabs, three decision cards over the existing catalog and acceptance endpoints), `composeBasis` (`services/evidenceBasis.ts` + frontend copy) storing the basis as text and JSON, `placed_from_session_id` on placements. Nothing decided on prod: Dana's calibration pass per lineup is next (DESIGN §12 row 5).

Status 2026-10-18 (night): all four briefs executed and on prod (`CLOSING_REPORT_1.md` to `_4.md`). The Calibration workbench is live under Roastery Feedback; nothing has been assigned, placed or accepted through it yet. Day-one queue: Joe Bean 4 flagged, Joe Coffee 5 flagged, Utopian 10 flagged + Flying Jewel without a basis. Next step is not a brief: Dana and Camila work the queue roastery by roastery (DESIGN §12 row 5).

Status 2026-10-23: **brief 7 executed, test then prod** (`CLOSING_REPORT_7.md`): the Earthy / C&N cupping is session 41 (Obsidian, Espresso Volo, Blossom, Amsterdam, Big City; Dana + Camila; 10 cupper rows, 5 merges, 12 cupper word mappings). Dana ruled her flavor-notes line is her call (earthy / chocolate_nutty on her rows and the merged rows). Big City's suggested slot moved, earthy 15 → 16; no signal for Obsidian and Volo (their pooled range includes session 39's word scale).

Status 2026-10-21 (late night): **brief 6 executed, test then prod** (`CLOSING_REPORT_6.md`):
- `v_coffee_dimension_range` pooled over every session (rank × half-life weights, `sessions_disagree`);
- `v_evidence_descriptor_consensus`;
- remarks resolved through the mapping at read time;
- `v_coffee_customer_descriptor`, read by every customer surface through `cuppingReads.getCustomerDescriptors`;
- no cupper prose in any customer prompt or endpoint;
- the Dimensions tab with session tags and weights;
- five parameters editable from the admin Configuration page (`evidenceParameterService`).

Status 2026-10-21 (night): **brief 6 written**: pooled recency-weighted ranges, descriptor consensus, customer voice led by the roaster (Dana's rulings after seeing session 40 move all four coffees the same way). The Dimensions-tab display issue (per-cupper cells show a cupper's latest row from any session, untagged) is folded into brief 6 Part D.

Status 2026-10-21 (evening): **brief 5 executed, test then prod** (`CLOSING_REPORT_5.md`): the Balance cupping is session 40 (Union, Benchmark, Fabricator, Geometric; Dana + Camila; 8 cupper rows, 4 merges, 12 cupper word mappings). The four coffees now show "newer evidence than the decision" in the workbench. The brief 3 tests are pinned to sessions 36 / 37 and coffee ids, never to the latest session.

Status 2026-10-21: **brief 4b executed** (`CLOSING_REPORT_4b.md`): workbench and evidence panel readability (width-driven layout, nothing under 12 px, no clipping or overprint at 1366 / 1440 / 1920; screenshots `workbench_after_<width>.png`). Display only, no logic.

Logged for their own small briefs, in no order: `schema.sql` cannot build an empty database; the 9-dimension printed sheet generated from `cupping_sheet_line` (Depth, brew box, control, blind code); `coffees.flavor_descriptors_roaster` derived from the accepted table and deprecated; the 20 pre-existing composite / natural-key tables retrofitted with an `id`; the SCA "Brown, Roast" split; Floral on Depth vs acidity, decided from the cupper calibration view once Depth is scored; Joe Coffee's and Joe Bean's lineups re-captured when their sites change (`website_recapture_days`). Added after brief 6 (2026-10-21): ranges in the seed notes for the eight older `evidence_parameter` keys so they become editable on the Configuration card; a design pass on the public flavor-wheel component now that bars are one per node and a coffee without roaster words shows an empty wheel; `v_palate_shared_traits` defined once (today an early definition is redefined after `v_coffee_customer_descriptor`); the mapping queue itself: 86 unmapped words, each one a roaster note that reaches the customer the moment it is mapped.
