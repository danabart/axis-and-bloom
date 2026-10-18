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
| `SUPERSEDED_*` | v1 and v2 of the design and the briefs. Kept for history only; never executed. |

Status 2026-10-17: v3 design and briefs 1 to 4 written; nothing executed; no evidence row loaded under any version. Brief 2's "Dana decides" items carry defaults (CHANGES §4); override before running.

Status 2026-10-18: **brief 1 executed and deployed** (`e9345da` + the Part C commit; `WHAT_WE_BUILT.md` #224, `CLOSING_REPORT_1.md`). Still no evidence row loaded from paper. Before brief 2, read the closing report's "for brief 2" list: Flying Jewel's existing Score Entry row (session 35) is tagged `legacy` though its values look like a 0 to 5 grid; `createSession` takes no `brewMethod` and keeps `brewDefaults` on the session (`cupping_sessions.brew_defaults`); the tier-2 nodes the mappings need now exist (Berry, Nutty, Cocoa, Brown Spice, Citrus Fruit, Dried Fruit), but three SCA mislabels in the seed (Raw, Anise, Brown/Roast) are inherited by the tree.
