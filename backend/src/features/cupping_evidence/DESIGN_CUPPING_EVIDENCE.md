# Cupping Evidence v3: how our cupping, roastery data and (later) customer data enter the database

> Folder: `backend/src/features/cupping_evidence/` · v2 written 2026-10-16 (CTO session; decisions by Dana) · **v3 amended 2026-10-17** (review session; decisions by Dana 2026-10-16/17) · Status: DESIGN, nothing executed yet
> v3 keeps the v2 text and adds a **v3** paragraph at the end of each section it changes. The full change table with reasons is `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md`; the inventory of tables, views, writers, readers and known alignment issues is `DESIGN_CUPPING_EVIDENCE_v3_SKETCH.md`; the transcription corrections are `TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md`. The v2 text alone is kept as `SUPERSEDED_DESIGN_CUPPING_EVIDENCE_v2.md`. No row was ever loaded under v1 or v2.
> **v4 note (2026-10-21, brief 6, decisions by Dana):** one rule replaced. "The catalog reads the latest session only" (§0b row 5, §4.8 v3, §7 v3) becomes **"the catalog reads every current session, weighted by recency"**: `v_coffee_dimension_range` pools every session's merged range, weighted by rank (`param('session_rank_ratio')` ^ rank, latest first: two sessions 60 / 40) and time (half-life `param('session_half_life_days')`), keeps its name, columns and `session_id` = latest, and adds `sessions_disagree` (`param('session_gap')`), a flag. Two companion rules from the same brief: our cupping notes are rolled up per node (`v_evidence_descriptor_consensus`, `k of n sessions`), and **a customer hears the roaster's words, never ours** (`v_coffee_customer_descriptor`: roaster accepted, roaster website, customers; our cupping adds `confirmed_by_cupping` on a roaster word it agrees with). Parameters are editable from the admin Configuration page through `evidenceParameterService`. Our cuppers' prose (`overall_notes`) reaches no customer prompt or public endpoint (Dana's ruling 7). Everything else in v3 stands. Brief: `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_6_POOLED_RANGE_CUSTOMER_VOICE.md`.
> Source material: `misc/roasteries/Utopian/CUPPING_NOTES.md`, `misc/roasteries/Joe Bean/Cupping 1 - Sep 2026/CUPPING_NOTES_Joe_Bean_2026-09-30.md`, `misc/roasteries/Joe Coffee/Cupping Oct 2, 2026/CUPPING_NOTES_Joe_Coffee_2026-10-02.md`, `misc/roasteries/intake/Roaster_Intake_Utopian.xlsx`

## 0. What changed from v1, in one table

| # | v1 | v2 | Why |
|---|---|---|---|
| 1 | Fragrance, Aroma, Flavor are text-only dimensions; the sheet's 0 to 15 intensity on them was stored inside a note string | Dimensions 1, 2, 3 become numeric 0 to 15 like the other five; the words stay in `notes` | The sheet scores eight dimensions (Dana, 2026-09-18). v1 lost three of them. |
| 2 | Converted scales (Camila's low/medium/high, her 0 to 5 grid) recognisable only by parsing `notes` | `cupping_scores.scale_code` (`ab_0_15`, `word_3`, `grid_0_5`, `legacy`) and `cupping_score_values.raw_value` (exactly what is on the paper) | Calibration views must be able to exclude conversion artifacts. A 14-15 that came from a "5" on a 0 to 5 grid is not a disagreement. |
| 3 | Single-cupper session: the cupper's row doubles as the merged row | Every cupper row is `is_merged = false`; the merged row is always made by `mergeByRule`, `taster_name = 'merged'`, even for one cupper | One shape for the per-cupper views. No special case. |
| 4 | `v_coffee_dimension_range` unions every merged row ever written for a coffee | Reads only current merged rows (`superseded_at IS NULL`); carries `n_sessions` and `all_ab_scale` | Otherwise a re-merge can only ever widen the range the dial and the D6 check read. |
| 5 | Cupping FKs `ON DELETE CASCADE`; immutability by service discipline only | FKs `RESTRICT`; immutability triggers on the evidence tables, same as the portal and `roastery_remark` | Direct DB writes happen (Dana, 2026-08-27). One `DELETE FROM coffees` would silently erase evidence. |
| 6 | Blind or not, roaster at the table or not, sample freshness: not recorded | `cupping_sessions.is_blind`, `roaster_present`, `sheet_format`, `record_source`; `cupping_session_coffees.roast_date`, `blind_code`, `sample_note` | Anchoring is the biggest confounder in any cupper-vs-roaster comparison. It has to be a column, not a sentence in session notes. |
| 7 | "Portal 1 to 5 by rank wins" for dimensions | The roaster's rank is a flag, never a value. Catalog dimension values come from our merged range only | A rank cannot be placed on a 0 to 15 dial. Nothing in the catalog could consume the v1 rule. |
| 8 | Dial signal fired on every merged save | Fired only when every contributing cupper row is `ab_0_15` | A union of a converted word scale with a real range has a meaningless midpoint. |
| 9 | Five reconciliation views | Seven: adds coverage (which coffees have which evidence) and unmapped words | Coverage is how you know when "enough data" has arrived, and it answers the "did I forget this table exists" worry directly. |
| 10 | Spearman `inverted` flag at any n | Needs n ≥ 5; below that the view shows the raw ranks and says `n too small` | At n = 4 the flag is noise and would cry wolf on Joe Bean. |
| 11 | Legacy Path session (seed, `session_1_merged`) untouched and indistinguishable | Tagged `scale_code = 'legacy'`, `record_source = 'seed:…'`, `sheet_format = 'legacy_wide'` | So the calibration views can leave it out without anyone remembering to. |
| 12 | Loads in two briefs across two folders; schema work mixed with data | Brief 1 = foundation (schema, services, lint, no data). Brief 2 = all loads (Joe Coffee, Joe Bean, Utopian). Brief 3 = views and read-only admin | A data brief should contain data only. |

Everything else in v1 stands: three layers, one table per source, roaster words verbatim, translation at the wheel-family level, archetype and slot are Axis & Bloom decisions only, flags are never gates, every decision states its basis, not a Data Vault.

## 0b. What v3 adds, in one table (detail and reasons in `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` §2)

| # | v3 principle or change | One line |
|---|---|---|
| 1 | Stored as observed, converted in reads | Native scale values in `cupping_score_values`; `cupping_scale` + `cupping_scale_step` + `cupping_to_ab()` convert in the views. A word is stored at the SCA node the cupper named (`cupping_note.tier`), never deeper: "berries" is Berry, not Blueberry. |
| 2 | Nothing hard-coded | `cupper`, `cupping_scale`, `cupping_sheet_format` + `_line`, `evidence_parameter` (+ `param()`), `evidence_stop_word`; views one row per cupper; mappings for cupper words in `roastery_portal_note_mapping` (`source_kind`), written only by `noteMappingService`; `cupping_note` is a tree (`parent_id`), so a family is a join, never a label match; `cupping_sessions.brew_method` deprecated in favour of `cupping_brew_params`. |
| 3 | Naming | Domain word first, `cupping_` stays, nothing renamed; new tables singular; `Class:` carries the layer (master / fact / operating / view). |
| 4 | One supersede transition on any `cupping_scores` row | Cupper rows too; re-save in Score Entry supersedes; guard compares `to_jsonb(OLD)` minus the three keys. |
| 5 | Latest session, history kept | `v_coffee_dimension_range` = latest current merged row; `v_coffee_dimension_history` = every session; `coffee_slot_assignment.placed_from_session_id`; `evidence_newer_than_decision`. |
| 6 | Evidence reaches customers through decisions only | `v_collaborative_flavor_wheel` internal branch = current merged rows, with `tier`. |
| 7 | Dial signal | `cuppingService.refreshDialSignal` after merge, after the loader's manifest, on archetype change; native scale only; retract otherwise. The suggested slot rests on `coffee_dial_slot.spec_band` when every slot of the archetype has one, else on the `archetype_vector` May targets split across the slots; the basis is written into the signal's `notes`. |
| 8 | Sessions and samples | `session_date NOT NULL` + precision; `transcribed_by / at`, `checked_by`; `is_control`; brew params written (8.5 g / 150 g standard). |
| 9 | Decision tables | `basis JSONB` on both assignment tables; decision FKs RESTRICT; `cupper_calibration_offset` exists, empty. |
| 10 | Transcription | A crossed-out or scribbled mark is never counted and is named in `raw_value`; a struck word is `~word` and never a descriptor row. Brief 2 corrected against a blind second read. Two-reader protocol for every paper session. |


## 1. The problem in one paragraph

We (Dana, Camila) cup every coffee we might sell and write scores, descriptors and an archetype call. Roasteries tell us about the same coffees through the portal form, at the cupping table, by email, and on their websites. Customers will tell us through feedback and, later, the collaborative wheel. We are not trained cuppers, so our numbers and words can be off; roasteries know their beans but classify by bean and by their own lineup, not by our families of taste. Nothing from any side is copied into the catalog as the truth. The catalog assignment (archetype, dial slot, leading notes, aftertaste and mouthfeel wording) is an Axis & Bloom decision that must be able to say what evidence it rests on, and the evidence must stay available, as written, so the decision can be revisited when there is more data.

## 2. Principle: observe, reconcile, decide

| Layer | What it holds | Mutability | Who writes |
|---|---|---|---|
| **Evidence** | One row per observation: who observed, when, through what channel, in their own words and on their own scale | Insert-only. Values never change; a correction is a new row that supersedes | One service per source (`cuppingService`, `roasteryPortalService`, `roasteryRemarkService`, the customer feedback writer) |
| **Reconciliation** | Per coffee and per facet: every source lined up, agreement and disagreement flagged, coverage counted | Views only, nothing stored | Nobody; derived |
| **Decision** | The catalog: `coffee_archetype_assignment`, `coffee_slot_assignment`, `roastery_coffee_descriptors`, each with a written basis | Supersede, never delete (existing discipline) | `catalogService` only |

Flags are never gates. No view and no rule writes the catalog. Dana reads the reconciliation and decides through the existing admin pages. A data-driven proposal column can come later, as a column in a view, never as a writer.

## 3. The sources of evidence

| # | Source | Table(s) | Scale | Writer |
|---|---|---|---|---|
| E1 | A&B cupping, per cupper | `cupping_sessions` → `cupping_session_coffees` → `cupping_scores` (`is_merged = false`) → `cupping_score_values`, `cupping_score_descriptors` | 0 to 15 absolute, ranges allowed; converted scales marked by `scale_code` | `cuppingService` |
| E2 | A&B cupping, merged by rule | `cupping_scores` with `is_merged = true`, `taster_name = 'merged'`, `merge_rule` set | 0 to 15 | `cuppingService.mergeByRule` only |
| E3 | Roaster, portal form | `roastery_portal_response` + `_note`, `_dimension`, `_brew`, `_lineup_response` | Dimensions 1 to 5, relative to the roaster's own lineup | `roasteryPortalService` (exists) |
| E4 | Roaster, outside the form | `roastery_remark`, `channel` in (`cupping_table`, `email`, `call`, `visit`) | Words | `roasteryRemarkService` (brief 1) |
| E5 | Roaster, published | `roastery_remark`, `channel = 'website'` | Words | same |
| E6 | Roaster, accepted into the catalog | `roastery_coffee_descriptors`, `roastery_portal_acceptance` | Wheel leaf | `catalogService` (exists). This is a decision, listed here because the views show it beside the evidence it came from |
| E7 | Customer | `customer_feedback_event`, `customer_feedback_descriptor`, `dial_position_signal` (`client_wheel`, `onsite_feedback`) | Words, 3-point | existing customer writer; `client_wheel` weight 0 |

Translation between vocabularies has one home: `roastery_portal_note_mapping` (their words → `cupping_note` leaf, remembered, superseded never deleted) and `cupping_note.wheel_category` (leaf → SCA family). All descriptor comparison happens at the family level through these two.

**Why `roastery_remark` is a new table and nothing existing fits** (DB governance rule, `CLAUDE.md`): `roastery_portal_*` holds what the roaster submitted through the form and is immutable per version; adding table talk to it would make the form data say things the roaster never typed. `cupping_scores.overall_notes` is our observation, not theirs. `roastery_coffee_descriptors` is the accepted (decision) layer. `coffees.flavor_descriptors_roaster` is a legacy array with no provenance. None can hold "who said what, when, through which channel, verbatim" for a roaster outside the form. `CATALOG.md` checked 2026-10-16: no other table carries roaster statements.

## 4. Schema: what brief 1 adds or changes

All idempotent (`ADD COLUMN IF NOT EXISTS`, `DO` blocks), all commented in `comments.sql`, `CATALOG.md` regenerated.

### 4.1 `coffee_dimensions`
Rows 1 Fragrance, 2 Aroma, 3 Flavor become `is_numeric = true`, `scale_min 0`, `scale_max 15`, labels `faint` / `intense`. Idempotent `UPDATE … WHERE id IN (1,2,3) AND is_numeric = false`. Existing text-only rows for these dimensions stay valid (`value_min/max` null, `notes` set). Score Entry renders them as the other numeric dimensions. The portal's seven dimensions are unaffected (`roastery_portal_dimension` is seeded by name and does not include 1 to 3).

### 4.2 `cupping_sessions` (header; metadata may be edited, never deleted while it has children)
| column | type | meaning |
|---|---|---|
| `record_source` | TEXT NOT NULL DEFAULT `'score_entry'` | Where the rows came from: `'score_entry'`, `'seed:<file>'`, `'paper:<files>; transcribed <date>'`. Backfill: existing rows get `'legacy:pre-2026-10 (score entry or seed)'`; the Path seed session gets `'seed:session_001_path_2026_05_27.sql'`. |
| `sheet_format` | TEXT | `'ab_0_15_9dim'` (next printed sheet, with Depth), `'ab_0_15_8dim'` (current printed sheet), `'ab_0_15_6dim'`, `'freeform_grid'`, `'legacy_wide'`. Null allowed for Score Entry sessions. |
| `is_blind` | BOOLEAN | Cuppers did not know which coffee was in which cup. |
| `roaster_present` | BOOLEAN | A roaster's person was at the table (their remarks could anchor our calls). |

### 4.3 `cupping_session_coffees`
| column | type | meaning |
|---|---|---|
| `roast_date` | DATE | When the sample was roasted, where known. |
| `blind_code` | TEXT | The code on the cup ("TIGER"). |
| `sample_note` | TEXT | Sample condition: "end-of-run lot", "last cup of the day". |

### 4.4 `cupping_scores` (one row per cupper per coffee, plus the merged row)
| column | type | meaning |
|---|---|---|
| `scale_code` | TEXT NOT NULL DEFAULT `'ab_0_15'` CHECK IN (`ab_0_15`, `word_3`, `grid_0_5`, `legacy`) | The scale the cupper actually used. Converted rows keep the conversion in `raw_value` (4.5). Backfill: every existing row gets `'legacy'`. |
| `archetype_call` | archetype_enum | The cupper's blind call as written. |
| `archetype_call_secondary` | archetype_enum | When she wrote two. |
| `position_call` | TEXT | Her words: "light", "med-strong", "delicate". |
| `slot_call_id` | INT REFERENCES coffee_dial_slot(id) | Only when the call names a slot unambiguously ("Bloom dial: light fruity"). |
| `call_note` | TEXT | "DEF", "partly crossed out", "no call; Nutty/Cocoa family ticked". A family tick is a note, never a call. |
| `merge_rule` | TEXT | Null on cupper rows. On merged rows: `'union_v1'` (§6). A hand merge in Score Entry writes `'manual'`. |
| `merge_note` | TEXT | Merged rows only: the disagreement list and the scale codes merged. |
| `superseded_at` | TIMESTAMPTZ | Set when a newer merged row replaces this one. Cupper rows are never superseded (a transcription correction is a new session coffee row with a note, see 6.4). |
| `superseded_by_id` | INT REFERENCES cupping_scores(id) | The replacing row. |
| `supersede_reason` | TEXT | Why. |

`UNIQUE (session_coffee_id, taster_name)` is replaced by a partial unique index `WHERE superseded_at IS NULL`. `taster_name` values: `'Dana'`, `'Camila'`, `'merged'`; the legacy seed's `'session_1_merged'` stays as is. A `cupper` table is not created now (two people); if a third cupper arrives the name becomes a FK then.

**v3.** `cupper_id INT REFERENCES cupper(id)` replaces `taster_name` as the key (`taster_name` stays as a deprecated legacy column; nothing new writes it, and `'merged'` is never written). `is_merged` is the only merged flag. `scale_code` is a FK to `cupping_scale`. Two partial unique indexes: one current cupper row per (session coffee, cupper), one current merged row per session coffee. **Any row, cupper or merged, allows exactly one transition**: set `superseded_at`, `superseded_by_id`, `supersede_reason` (required), change nothing else. Re-saving a cupper row in Score Entry supersedes the current row with `'edited in Score Entry'`; a transcription correction supersedes with `'transcription correction'`; a re-merge with `'merged by rule again'`.

### 4.5 `cupping_score_values`
| column | type | meaning |
|---|---|---|
| `raw_value` | TEXT | Exactly what is on the paper for this dimension: `'7-9'`, `'marks at 2,4,5,6,8; crossed 4'`, `'low'`, `'grid 0-5: 4'`, `'two readings: 3-4 and 6-8 (lime)'`. `value_min/max` is the interpretation; `raw_value` is the observation. |

`notes` keeps the words written next to the scale (descriptors, "lime"). Nothing else changes.

**v3.** `value_min/max` hold the value **on the scale used** (`grid_0_5`: 4 / 4; `word_3`: null / null with `raw_value = 'low'`; `ab_0_15`: as written). `cupping_to_ab(scale_code, value_min, value_max, raw_value)` returns the 0 to 15 pair from `cupping_scale_step`; `v_cupping_scores_readable` and `v_coffee_dimension_range` expose the converted pair as `value_min/max` and the native pair as `native_min/max`. A crossed-out or scribbled mark is never counted; `raw_value` names it (`'4-6; marks at 2 and 8 struck'`). A struck word stays in `notes` as `~word` and never becomes a descriptor row.

### 4.6 FKs and triggers on the five `cupping_*` tables
- Every `ON DELETE CASCADE` on `cupping_session_coffees.session_id`, `.coffee_id`, `cupping_scores.session_coffee_id`, `cupping_score_values.cupping_score_id`, `.dimension_id`, `cupping_score_descriptors.cupping_score_id`, `.cupping_note_id`, `cupping_brew_params.session_coffee_id` becomes `ON DELETE RESTRICT` (drop constraint, re-add; idempotent `DO` block keyed on the constraint's `confdeltype`).
- `cupping_score_values`, `cupping_score_descriptors`: BEFORE UPDATE OR DELETE trigger raises `integrity_constraint_violation` ("cupping evidence is immutable"). Same function shape as `roastery_portal_*_immutable`.
- `cupping_scores`: BEFORE DELETE raises. BEFORE UPDATE allows exactly one transition: `OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL` and every other column unchanged; anything else raises.
- `cupping_sessions`, `cupping_session_coffees`: UPDATE allowed (header metadata), DELETE blocked by RESTRICT while children exist; `cuppingService.removeEmptySession` / `removeEmptySessionCoffee` are the only delete paths and refuse when a score exists.
- Grants: `ab_app` loses `UPDATE, DELETE, TRUNCATE` on `cupping_score_values` and `cupping_score_descriptors` and `DELETE, TRUNCATE` on `cupping_scores` (the trigger is the guard; the grant is belt and braces, the customer-table pattern).

**v3.** The `cupping_scores` guard allows the transition on cupper rows as well as merged rows and compares `(to_jsonb(OLD) - 'superseded_at' - 'superseded_by_id' - 'supersede_reason') = (to_jsonb(NEW) - …)`, so a column added later is guarded without a code change. `ON DELETE CASCADE` → `RESTRICT` also on `coffee_archetype_assignment.coffee_id`, `coffee_slot_assignment.coffee_id` and `dial_position_signal.coffee_id`. `cupping_brew_params`: editable until a score exists under the session coffee, then immutable; never deleted. Legacy tagging is date-free: `ADD COLUMN … DEFAULT 'legacy'` then `SET DEFAULT 'ab_0_15'`.

### 4.7 `roastery_remark` (new; E4 + E5)
```sql
CREATE TABLE IF NOT EXISTS roastery_remark (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id                UUID NOT NULL REFERENCES roaster(id),
  coffee_id                 INTEGER REFERENCES coffees(id),                   -- null = about the lineup or the roastery
  portal_coffee_id          UUID REFERENCES roastery_portal_coffee(id),       -- the lineup row, when known
  cupping_session_coffee_id INTEGER REFERENCES cupping_session_coffees(id),   -- where it was said, when at a cupping
  said_by                   TEXT NOT NULL,                                     -- 'Natalie (Joe Coffee, marketing director)' / 'Utopian Coffee Co. (utopiancoffee.com)'
  said_by_respondent_id     UUID REFERENCES roastery_portal_respondent(id),   -- when the person is a known portal respondent
  said_on                   DATE NOT NULL,                                     -- business date; never shifted by a timezone
  channel                   TEXT NOT NULL CHECK (channel IN ('cupping_table','email','call','visit','website','other')),
  topic                     TEXT NOT NULL CHECK (topic IN ('classification','descriptor','dimension','brewing','availability','process','origin','roast','general')),
  remark                    TEXT NOT NULL,                                     -- their words as captured, verbatim
  cupping_note_id           UUID REFERENCES cupping_note(id),                 -- wheel pick for a descriptor remark, when the translation is clear
  proposed_archetype        archetype_enum,                                    -- for a classification remark; a proposal, never an assignment
  recorded_by               TEXT NOT NULL,                                     -- who wrote it down
  record_source             TEXT NOT NULL,                                     -- 'paper: <file>' / 'email 2026-10-09' / 'utopiancoffee.com via <xlsx> (Sep 2026)'
  supersedes_id             UUID REFERENCES roastery_remark(id),              -- a transcription correction points at the row it corrects; the old row is never touched
  load_dts                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cupping_note_id IS NULL OR topic = 'descriptor'),
  CHECK (proposed_archetype IS NULL OR topic = 'classification')
);
```
Insert-only trigger (BEFORE UPDATE OR DELETE raises). BEFORE INSERT guard: `coffee_id` and `portal_coffee_id` must belong to `roaster_id`; `supersedes_id` must point at a row of the same roaster. Indexes on `(coffee_id)`, `(roaster_id, said_on)`. Grants: `ab_app` SELECT, INSERT only. View `v_roastery_remark`: every column plus `roaster_name`, `coffee_name`, `portal_coffee_name`, `cupping_note_descriptor`, `wheel_category`, `is_current` (no newer row supersedes it).

### 4.8 Existing views touched
- `v_cupping_scores_readable`: adds `scale_code`, the call columns, `merge_rule`, `merge_note`, `raw_value`, `is_blind`, `roaster_present`, `record_source`, `session_id`, `session_coffee_id`, `score_id`; filters `superseded_at IS NULL`.
- `v_coffee_dimension_range`: merged CTE filters `superseded_at IS NULL`; adds `n_sessions`, `midpoint`, `all_ab_scale` (every contributing cupper row has `scale_code = 'ab_0_15'`). The `unmerged` fallback stays for coffees that have cupper rows but no merged row yet.
- New small views for Score Entry reads if the readable view does not cover them: `v_cupping_session`, `v_cupping_session_coffee`.

**v3.** `v_coffee_dimension_range` reads the **latest** current merged row per coffee (by `session_date`, then `created_at`), converted, with `session_id`, `session_date`, `n_sessions`, `midpoint`, `all_ab_scale`; it never unions sessions. `v_coffee_dimension_history` is one row per coffee × dimension × session for calibration and repeatability. `v_coffee_dimension_range_calibrated` applies `cupper_calibration_offset` and is read by nothing until Dana says. `v_collaborative_flavor_wheel`'s internal branch reads `is_merged AND superseded_at IS NULL` only and every branch exposes `cupping_note.tier`, so the customer-facing wheel shows decision-layer words and shows a generic word as generic. `v_cupping_scores_readable` carries `cupper_id`, `cupper_name`, `native_min/max`, `conversion_error`, `is_control`, `session_date_precision`, `transcribed_by`, `checked_by`.

## 5. Services and lint (brief 1)

**`services/cuppingService.ts`, the only writer of `cupping_*`:**
- `createSession({ sessionDate, brewMethod, location, sessionNotes, recordSource, sheetFormat, isBlind, roasterPresent })`
- `addSessionCoffee(sessionId, coffeeId, { displayOrder, roastDate, blindCode, sampleNote })`
- `saveCupperScore(input)`: one transaction; `taster_name` (not `'merged'`), `scale_code`, the call columns, `values[]` (`dimensionId`, `valueMin`, `valueMax`, `rawValue`, `notes`), `descriptors[]` (`cuppingNoteId`, `intensity`, `customNotes`). Validation: numeric dimension requires min ≤ max within the dimension's scale; `raw_value` required when `scale_code <> 'ab_0_15'` or when min ≠ max; a free-text dimension requires null min/max. Never fires the dial signal.
- `mergeByRule(sessionCoffeeId, { n = 2 })`: reads the current cupper rows for that session coffee, builds the merged row per §6 through the pure, unit-tested `unionScores(rows, n)`, supersedes any current merged row for that session coffee (`superseded_at`, `superseded_by_id`, `supersede_reason = 'merged by rule again'`) and inserts the new one in the same transaction, `taster_name = 'merged'`, `merge_rule = 'union_v1'`. Then, only if every contributing row is `ab_0_15`, calls `recordCuppingSignal(coffeeId)` (the one caller in the codebase).
- `saveManualMerge(sessionCoffeeId, input, reason)`: Score Entry's hand merge; same supersede path, `merge_rule = 'manual'`, signal only under the same scale condition.
- `supersedeMergedScore(scoreId, reason)`: for a merged row only; cupper rows throw `CUPPING_CUPPER_ROW_IMMUTABLE`.
- `removeEmptySession(sessionId)` / `removeEmptySessionCoffee(scId)`: only when nothing is underneath, otherwise `CUPPING_HAS_EVIDENCE`.
- Routes in `routes/admin.ts` become thin callers; same URLs and shapes so `AdminScoreEntry` keeps working; "delete score" calls `supersedeMergedScore` and the UI label becomes "Supersede".

**`services/cuppingReads.ts`, the only reader, over views only.** Moves the four direct readers (`dialSuggestion.getAvgCuppingScore(sBatch)`, `brewCard`, `routes/coffees.ts`, Score Entry reads in `routes/admin.ts`) onto `v_coffee_dimension_range`, `v_coffee_descriptor`, `v_cupping_scores_readable`, `v_cupping_session`, `v_cupping_session_coffee`. A view missing a column a reader needs gains the column.

**`services/roasteryRemarkService.ts` / `roasteryRemarkReads.ts`:** `recordRemarks(RemarkInput[], ctx)` in one transaction, validates channel, topic, archetype code, leaf existence, ownership; `listRemarks({ roasterId?, coffeeId?, currentOnly = true })` from `v_roastery_remark`. Route `/api/admin/roastery-remarks` (GET, POST) behind `requireAdmin`. No frontend in brief 1.

**`scripts/lint-cupping.mjs`** (clone of `lint-roastery-portal.mjs`): DML on `cupping_*` only in `cuppingService.ts`; `FROM`/`JOIN cupping_*` base tables only in `cuppingService.ts`, `cuppingReads.ts`, `schema.sql`, seeds and tests; `recordCuppingSignal(` only in `cuppingService.ts`. `lint-roastery-portal.mjs` gains the same two rules for `roastery_remark`. Both wired into `package.json` and `deploy.yml` beside the other four. Report-only boot check stays as it is (data catalog posture, 2026-10-16): the lint blocks in CI, nothing blocks at boot.

**v3.** `cuppingService` also owns `saveBrewParams` (the first writer of `cupping_brew_params`; `createSession` takes `brewDefaults` applied to every session coffee), `addCupper` / `listCuppers`, and `refreshDialSignal(coffeeId)`: reads the latest merged range, calls `dialSuggestion.recordCuppingSignal` when `all_ab_scale`, otherwise `recordCuppingSignal(coffeeId, { retract: true })`; called from `mergeByRule`, `saveManualMerge`, the brief 2 loader after the manifest, and `catalogService.setMatchArchetype` when the archetype changes. `saveCupperScore` takes `cupperId`; when a current row exists for that cupper it supersedes it and re-merges. `mergeByRule` reads its gap from `param('cupper_gap')`. `cuppingReads` also lists cuppers, scales and sheet formats for Score Entry. The lints: `lint:cupping` (DML and base reads, the reference tables seed-only, `recordCuppingSignal` / `refreshDialSignal` call sites, `v_evidence_` reads) beside `lint:catalog`, `lint:customer`, `lint:retention`, `lint:roastery-portal` and `lint:lineage`; the `Writer:` fields in `comments.sql` for the six cupping tables are rewritten to `cuppingService.*` in the same commit as the service.

## 6. Loading rules (the evidence layer)

### 6.1 Catalog rows first
A cupping row needs a `coffees` row. Every cupped coffee gets one through the import manifest (`catalogService`, dry run first). Unplaced and without a sale unless Dana has already decided to sell it (the Joe Coffee four). The importer requires the anchor 12 oz SKU on every coffee; an unplaced coffee with a SKU is still invisible and unsellable. Lineup rows in `roastery_portal_coffee` are linked (`linkLineupCoffeeToCatalog`) so portal submissions can later be accepted onto the right coffee. A provisional archetype on a new unplaced coffee carries `confidence = 'low'` (or `'medium'` when both cuppers made the same call), `source = 'cupping'`, and a basis line (§8.3) ending `provisional, pending the calibration pass`.

### 6.2 One row per cupper, as written
- `taster_name` `'Dana'` / `'Camila'`, `is_merged = false`, `scale_code` per the sheet.
- Dana's ranges → `value_min/max`; a single circled point → `min = max`; several marks → the span, `raw_value = 'marks at 2,4,5,6,8'`; crossed-out marks are not counted and appear in `raw_value` as `'; crossed 4'`. Two readings on one line → one span, `raw_value = 'two readings: 3-4 and 6-8 (lime)'`.
- Camila's points → `min = max`, `scale_code = 'ab_0_15'`.
- Camila's word scale (Utopian flight B) → `scale_code = 'word_3'`: low 0 to 5, medium 5 to 10, high 10 to 15; `raw_value = 'low'`.
- Camila's 0 to 5 grid (Utopian flight A) → `scale_code = 'grid_0_5'`: `v×3`, width 3, clamped: 0 → 0–1, 1 → 2–4, 2 → 5–7, 3 → 8–10, 4 → 11–13, 5 → 14–15; `raw_value = 'grid 0-5: 4'`.
- Intensity on Fragrance / Aroma / Flavor → `value_min/max` on dimensions 1, 2, 3 (numeric from brief 1); the words → `notes`. Where the sheet has words only, min/max null.
- Numeric "Mouthfeel light to heavy" = 7 Body; "Aftertaste short to long" = 10 Finish Length; mouthfeel words = 12; aftertaste words = 11. A mark that was texture, not weight (La Familia 9–11) → Body unscored, the words to 12, `raw_value` on 12 explains.
- Every word that maps to a wheel leaf also goes to `cupping_score_descriptors` with the exact words in `custom_notes`; conventions: berries → Blueberry; nuts → Hazelnut; cocoa / milk chocolate / chocolate → Chocolate; spice → Cinnamon; tea / black tea / green tea → Black Tea; burned / burnt / roasty → Roast; citrus → Orange; dried fruits → Raisin; sugarcane / cane → Molasses; syrup → Maple Syrup. Words with no leaf stay in the dimension `notes` only.
- Archetype and position calls → the call columns. A family tick or circle → `call_note`. A call the cupper did not write stays null.
- Remarks a roaster made that the cupper wrote on her own sheet are roaster evidence → `roastery_remark`, `said_by` the roaster's person, `recorded_by` the cupper.
- Struck-through words are kept with a `~` prefix, as the notes files do.
- **Only Axis & Bloom cuppers have rows in `cupping_scores`.** When a roaster's person scores or comments at the table (Natalie, Kathy), that is a `roastery_remark` with `topic = 'dimension'` or `'descriptor'`, never a `taster_name`. A third taster name would quietly turn roaster opinion into our evidence.
- **From the next session, Depth is scored.** Dimension 9 Savory / Depth exists and the portal asks it ("Clarity: clean to layered"); the printed sheet has never carried it, so the open question "do complex floral / fruity travel on acidity, depth or both" (2026-10-09) cannot be answered from the rows. The next printed sheet adds it and its `sheet_format` is `'ab_0_15_9dim'`. The loads in brief 2 have no Depth values and none are invented.

**v3.** Three rules replace the conventions above where they conflict. (1) **A strike is not a mark**: a crossed-out or scribbled-over mark is never counted and is named in `raw_value`; a struck word stays as `~word` in `notes` and never becomes a descriptor row (this withdrew brief 2's "two acidity readings are one span": the second readings are struck). (2) **Native values**: Camila's grid digit and word are stored as written (`grid_0_5`: 4; `word_3`: null + `raw_value = 'low'`); the views convert through `cupping_scale_step`, so the conversion can change without touching a row. (3) **Most specific SCA node named, never deeper**: berries → Berry (tier 2), nuts → Nutty, cocoa → Cocoa, chocolate → Chocolate (leaf), spice → Brown Spice, citrus → Citrus Fruit, dried fruits → Dried Fruit, fruits → Fruity (tier 1); every such mapping is a row in `roastery_portal_note_mapping` with `source_kind = 'cupper'`, written through `roasteryPortalService.setNoteMapping`, and the loader refuses a word it cannot look up. Also: the sheet line → dimension mapping lives in `cupping_sheet_line`, not in the loader; every session coffee gets a `cupping_brew_params` row (8.5 g / 150 g standard, unrecorded fields null); every session carries `transcribed_by`, `transcribed_at`, `checked_by`; a control coffee (`is_control`) is cupped in every session from now on.

### 6.3 The merged row, by rule (`union_v1`)
One merged row per session coffee, through `mergeByRule`, also when there is one cupper:
- Numeric dimension: the union of the cuppers' ranges. Scored by one cupper only: her range, `merge_note` lists `one cupper: <dim>`.
- Descriptors: the union of leaves; `custom_notes` concatenates per cupper (`Dana: cocoa, choc; Camila: bitter choc`).
- Archetype call: filled only when every cupper who made a call made the same one; otherwise null and `call_note` lists them. Position call and slot call the same way.
- `merge_note`: `'union_v1; scales: Dana ab_0_15, Camila grid_0_5; cupper disagreement (gap > 2) on: Acidity, Sweetness'`. Disagreement = the gap between two cuppers' ranges is greater than n (overlap, or a gap of exactly n, agree).
- Dial signal: only when all contributing rows are `ab_0_15`. Otherwise `merge_note` adds `'; no dial signal (converted scale)'`.
- A hand re-merge supersedes; the cupper rows are untouched.

### 6.4 Correcting a transcription
**v3.** Values never change; rows are superseded. A transcription error is fixed by `saveCupperScore` for the same session coffee and cupper with `supersedeReason = 'transcription correction: <what>'`: the new row is inserted, the old row gets its one transition, `mergeByRule` re-merges and supersedes the old merged row. Nothing is edited, nothing is deleted, the history view keeps the old row, the current views show the new one. The same path serves Score Entry's "save again" (`'edited in Score Entry'`). Before any paper session is loaded, it is transcribed, blind re-transcribed in a fresh session, diffed, and only the diff goes to Dana (`TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md` is the first).

### 6.5 Roaster words
`roastery_remark`, one statement per row, verbatim:
- Cupping-table remarks: `channel = 'cupping_table'`, `cupping_session_coffee_id` set, `said_on` = session date.
- Published notes: `channel = 'website'`, `record_source` names the page and the file it was copied from, `said_on` = the capture date, `topic = 'descriptor'` one row per note, plus `process` and `roast` rows where published.
- `cupping_note_id` set when the translation is clear (Honeycomb → Honey); the same mapping is remembered in `roastery_portal_note_mapping` through its service so the same words map the same way next time. Unclear words stay unmapped and appear in the unmapped-words view (§7.7).
- A roaster's archetype-like statement → `topic = 'classification'` with `proposed_archetype`. A proposal, never an assignment.

### 6.6 Idempotent loads
Every load script checks by natural key before writing (roaster + coffee name + session date or flight label + taster; remark: roaster + coffee + said_on + channel + remark text) and reports `already loaded` instead of inserting twice. A load that fails midway reports what was written and stops; the next run continues from the natural keys.

### 6.7 What is never loaded as evidence
Claude's transcription verdicts in the notes files (`match: close / far`, the "Patterns" sections). Those are analysis; §7 recomputes them from rows.

## 7. Reconciliation (views, nothing stored; brief 3)

All named `v_evidence_*`, created with DROP VIEW + CREATE VIEW, granted to `reporting_ro`, commented, in `CATALOG.md`. They read evidence through the existing views where one fits (`v_coffee_dimension_range`, `v_cupping_scores_readable`, `v_roastery_remark`, `v_roastery_portal_current_response`, `v_collaborative_flavor_wheel`), never base tables, so a base-table change has one place to propagate. Every view that compares cuppers carries `scale_codes` and the calibration views exclude `scale_code <> 'ab_0_15'` by default (a `_all_scales` variant is not built; the column is there if someone wants to filter differently).

**v3.** No view names a cupper: views that compare cuppers are one row per coffee × dimension × cupper (`v_evidence_dimension`, `v_evidence_archetype_call`), and the UI pivots. Every threshold is `param('<key>')` from `evidence_parameter`; the stop list is `evidence_stop_word`. Per-coffee views read the latest session (`v_coffee_dimension_range`); the calibration views read `v_coffee_dimension_history` and gain `n_control`, `mean_signed_gap_to_catalog` and `repeatability`. Rank correlation uses average ranks for ties. `v_evidence_archetype` and `v_evidence_coverage` carry `evidence_newer_than_decision`. The D6 `descriptor_off_family` warning in `catalogService` reads families from `v_evidence_descriptor` through `evidenceReads.getFamilies`. Column lists are in brief 3 v3.

**v4 (2026-10-21, brief 6).** Replaces "per-coffee views read the latest session" above. Per-coffee views read the **pooled** range: every current merged session of the coffee contributes, each weighted by `param('session_rank_ratio') ^ rank × 0.5 ^ (days before the latest session / param('session_half_life_days'))`, normalised; min, max and midpoint are the weighted averages. One session is a sample, not the answer. `session_id` / `session_date` still name the latest session (what `evidence_newer_than_decision` and `placed_from_session_id` compare against). `sessions_disagree` (two pooled sessions' midpoints differ by more than `param('session_gap')`) joins the flag set of 7.1; `v_coffee_dimension_history` is where one sees which session pulled. The dial signal reads the pooled midpoint and says so in its notes. `v_coffee_dimension_range_calibrated` stays latest-session by design until offsets are decided. Descriptors: §7.2 is joined by `v_evidence_descriptor_consensus` (one row per coffee × node from the cupper rows, `k of n sessions`), and customers hear `v_coffee_customer_descriptor` (§8.1's descriptor row, applied outside: roaster first, ours only as confirmation).

### 7.1 `v_evidence_dimension`: one row per coffee × numeric dimension
`dana_min/max`, `camila_min/max`, `merged_min/max`, `merged_midpoint`, `scale_codes`, `cuppers_agree` (gap ≤ 2), `roaster_value_1_5` (current submitted portal response), `roaster_rank_in_lineup`, `ab_rank_in_lineup` (merged midpoint within the same roastery's cupped coffees), `rank_gap`, `roaster_agrees` (`rank_gap < 2`), `flag` (`none` / `cuppers_disagree` / `roaster_disagrees` / `both` / `one_source`), `n_sessions`, `is_blind`, `roaster_present`.
Why ranks: our scale is absolute, theirs is relative to their own lineup. Never compared by value. The rank is a flag; it never becomes a catalog value (§8.1).

### 7.2 `v_evidence_descriptor`: one row per coffee × SCA family
`named_by_dana`, `named_by_camila`, `named_by_roaster_form`, `named_by_roaster_remark`, `named_by_roaster_website`, `named_by_customer`, `accepted_in_catalog` (E6), `hit` (we and the roaster), `miss` (roaster only), `extra` (we only).

### 7.3 `v_evidence_archetype`: one row per coffee
`dana_call`, `camila_call`, `merged_call`, `roaster_form_proposal`, `roaster_remark_proposal`, `catalog_archetype` (from `v_coffee`), `catalog_confidence`, `catalog_home_slot`, `position_calls`, `slot_calls`, `slot_spec_check` (the D6 band result for the current placement against the current merged range), `basis` (from `coffee_archetype_assignment.notes`), `assigned_from_session_id`, `is_blind`, `roaster_present`.

### 7.4 `v_evidence_roastery_calibration`: one row per roastery × dimension
Spearman rank correlation between our merged midpoints and the roaster's 1 to 5 values across that roastery's lineup, `n`, `mean_rank_gap`, `inverted` (correlation < −0.5 **and n ≥ 5**; below that `inverted` is null and `note = 'n too small'`). Per roastery also: archetype crosstab counts (our merged call × their proposal), descriptor hit / miss / extra counts by family, `n_blind`, `n_roaster_present`. `ab_0_15` rows only.

### 7.5 `v_evidence_cupper_calibration`: one row per cupper × dimension
Mean signed gap between the cupper's midpoint and the other cupper's, mean range width, count of disagreements, mean signed gap to the roaster's rank-implied position, `n`, split by `is_blind`. `ab_0_15` rows only. This is what turns "we are not trained cuppers" into a per-dimension correction we can apply, or decide not to, once n is in the twenties.

### 7.6 `v_evidence_coverage`: one row per catalog coffee
`has_cupping_dana`, `has_cupping_camila`, `has_merged`, `n_sessions`, `last_cupped`, `has_portal_submitted`, `portal_version`, `has_remark_table`, `has_remark_website`, `has_customer_feedback`, `n_sources` (0 to 5), `catalog_archetype`, `catalog_confidence`, `assignment_basis_present`, `flag_unreconciled` (any flag in 7.1 to 7.3). The System Health card and the "when is there enough data" question read this view.

### 7.7 `v_evidence_unmapped_words`: one row per distinct roaster or cupper word with no wheel leaf
`word`, `source` (`roaster_form` / `roaster_remark` / `roaster_website` / `cupper_notes`), `n_coffees`, `example_coffee`. The queue for the mapping table.

## 8. Decision rules (the catalog)

### 8.1 Precedence is per facet, not per source
| Facet | Rule | Why |
|---|---|---|
| Descriptors / leading notes (wheel family) | Roaster (form, then remark, then website) over our cupping; ours flags | They know their beans; their notes are what the customer reads on the bag |
| Dimension values | Our merged range only. The roaster's lineup rank is a flag (7.1) and a calibration input (7.4), never a value | A rank cannot be placed on a 0 to 15 dial |
| Aftertaste / mouthfeel wording | Ours, with theirs beside it | The form does not ask for these in words |
| **Archetype** | **Axis & Bloom only** | Our families are roast- and taste-driven; theirs are bean-driven (the Earthy vs Chocolate & Nutty case). Their proposal is evidence, never a vote |
| **Dial slot / position** | **Axis & Bloom only**, checked against `coffee_dial_slot.spec_band` on the current merged range | Same reason; plus the slot is a product decision |

Dana's override path with a note stays available for any facet.

### 8.2 Nothing automatic
No view writes the catalog. `assignCoffee` / `placeCoffee` stay the only doors. The views are read on the admin side when Dana decides; the basis is written at that moment.

### 8.3 Every decision states its basis
`coffee_archetype_assignment.notes` and `coffee_slot_assignment.placement_note` carry one line in a fixed shape, and `assigned_from_session_id` points at the session:
`basis: cupping s<id> (Dana=earthy, Camila=earthy; blind); roaster form v1 (Kathy)=chocolate_nutty; website=Dark roast, Campfire; rule: A&B family is roast-driven → earthy; slot by body 8-10 → earthy/3`
7.3 shows the basis beside the evidence it names, so nothing is copied. A structured evidence-link table is not built now (it would be a new table under the governance rule and the session FK already exists); it is the first thing to add when the proposal column (8.5) is built.

**v3.** The basis is stored twice: the text line above in `notes` / `placement_note`, and the same facts as `basis JSONB` on `coffee_archetype_assignment` and `coffee_slot_assignment` (`{ sessions, calls: {<cupper>: <call>}, roaster_form, roaster_remarks, website, merged_range, band, rule }`), composed by the same pure `composeBasis` (brief 4) that returns `{ text, json }`. `assignment_basis_present` = `basis IS NOT NULL`. Placements also record `placed_from_session_id`, parallel to `assigned_from_session_id`, so a re-cupping shows as `evidence_newer_than_decision` instead of silently moving the range.

### 8.4 Calibration pass per lineup, through the Calibration workbench (brief 4)
Before a lineup goes live, Dana works through that roastery's coffees in the Calibration workbench (admin, under Roastery Feedback): the evidence of 7.1 to 7.3 on the left, three decision forms on the right, each over an existing `catalogService` door (`setMatchArchetype`, `placeCoffee` / `certifyPlacement`, `setRoasterDescriptors` via portal acceptance). The workbench composes the basis line of 8.3 from the rows on screen (the rule part is typed), makes it mandatory, and passes `assigned_from_session_id`. It never computes a decision and adds no writer. A pass over a view, not a re-cupping.

### 8.5 Later: data-driven proposals
When 7.6 shows enough coffees with `n_sources ≥ 2`, a rule can propose assignments from the rows (slot by merged range vs spec band, family by descriptor hits). A proposal column in 7.3, never a writer, until Dana decides otherwise. Not built now.

## 9. Customers and the collaborative wheel (later)
Customer observations are E7 and already weighted 0 for dial purposes. When the collaborative wheel ships, each submission is one evidence row tied to an order (coffee and brew known), appears in 7.2 as `named_by_customer` and in 7.6. The weight stays 0 until the rows show how customer words relate to cupping-bowl words. That is a measurement, not a number to pick now.

## 10. Supersede: how it is implemented here
Two house patterns, each used where it fits:
- **`superseded_at` on the old row** (plus `superseded_by_id` and a reason where the chain matters): the one writer sets it in the same transaction that inserts the replacement; current = `superseded_at IS NULL`; a partial unique index guarantees one current row per key; the immutability trigger allows exactly that one transition and nothing else. `created_at` is the valid-from, `superseded_at` the valid-to, so it is SCD Type 2 without a separate history table. Used where a view needs "the one current row": merged scores, catalog assignments, note mappings, dial signals.
- **`supersedes_id` on the new row**: the old row is never touched at all; current = no newer row points at it. Pure insert-only, no UPDATE grant needed, but "current" is an anti-join and cannot be a unique index. Used for verbatim observations where corrections are rare: `customer_feedback_event`, `roastery_remark`.
Dates alone, without the pointer, lose the chain of what replaced what; the pointer alone, without the date, makes "current" expensive. Where both are cheap, both are kept.

## 11. Governance
- Every evidence row carries business time (`session_date`, `said_on`, `submitted_at`) and system time (`created_at` / `load_dts`). Never one standing in for the other.
- Every evidence row carries its `record_source` (sessions: the sheet files; remarks: the paper or page; portal: the response id).
- Only the services named here write their tables; the lints prove it in CI; the boot check reports, never blocks.
- `COMMENT ON` every new table, column and view in `comments.sql`; `CATALOG.md` regenerated at the end of every brief (`CLAUDE.md`).
- Nothing deleted or dropped. Re-merges supersede; cupper rows, values, descriptors and remarks are immutable.
- `WHAT_WE_BUILT_DB.md` gets one section "Cupping evidence" pointing here.
- **v3.** Nothing hard-coded: cuppers, scales, sheet formats, thresholds, stop words and word mappings are rows; a view that compares cuppers has one row per cupper. Stored as observed: conversions and vocabulary roll-ups happen in reads. A crossed-out mark is never counted; a struck word is never a descriptor. Reference = `Class: master`, evidence = `fact`, decision = `operating`, reconcile = `view`.

## 12. Brief sequence

| # | Brief | Does | Model |
|---|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md` | §4 schema, §5 services and lint, legacy tagging, tests, comments, `CATALOG.md`. No data. | Sonnet |
| 2 | `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md` | Joe Coffee (8 coffees, 4 placed, session 2026-10-02, 38 remarks), Joe Bean (4, session 2026-09-30), Utopian (9 new + Flying Jewel, three flights, 52 website remarks), lineup links. Data only. | Sonnet |
| 3 | `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md` | The seven views of §7, tests, grants, comments, a read-only evidence panel on the Coffees page, a Calibration tab under Roastery Feedback, a System Health card from 7.6. | Sonnet for views; Dana reads the view definitions before it runs |
| 4 | `CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_4_WORKBENCH.md` | The Calibration workbench of §8.4: one admin page over the brief 3 views and the existing catalog doors; basis composed from evidence, mandatory; no schema, no new writer. | Sonnet |
| 5 | (no brief) calibration pass per lineup | Dana's decisions in the workbench, roastery by roastery. | |

## 13. Open points, with the default the briefs use unless Dana says otherwise
1. Conversions for Camila's scales (`word_3` thirds, `grid_0_5` `v×3` width 3) are rows in `cupping_scale_step`; the defaults stand and changing them touches no evidence row (v3).
2. Cupper-vs-cupper gap 2, rank gap 2, rank-correlation minimum n 3, Spearman minimum n 5, rho cut −0.5, calibration minimum n 20: rows in `evidence_parameter`, read by `param()` (v3).
3. Utopian flights B and C have no date on the sheets; loaded as `2026-09-20`, `session_date_precision = 'estimated'` (Dana, 2026-10-16); Dana can set the exact date in Score Entry.
4. ~~Joe Coffee's and Joe Bean's website text is not transcribed yet~~ Captured from their product pages on 2026-10-18 and loaded by brief 2 (D7, D8), so all three roasteries carry the same five sources from the first load. The capture date is `said_on`; a page can change after a coffee was cupped, and the date is what says which version we read.
5. `coffees.flavor_descriptors_roaster` is a second home for the accepted-descriptor decision (written by `acceptResponse` and the importer, read by the product page). Outside briefs 1 to 4: derive it in `v_coffee` from `roastery_coffee_descriptors`, mark it `Class: deprecated`, stop writing it (v3, alignment issue 8).
6. Transcription items marked "Dana decides" in `TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md` carry the defaults of `DESIGN_CUPPING_EVIDENCE_v3_CHANGES.md` §4 in brief 2; Dana overrides any line before brief 2 runs.

## 14. Why not a Data Vault (decided 2026-10-16, unchanged)
Append-only, source-specific tables with `record_source` and `load_dts`, which is what §3 is. The Cloud SQL database is the operational system. A formal vault (hash keys, links, one satellite per source with hash diffs) buys integration at warehouse scale at the price of every operational read becoming a multi-join. The vault habits we want, we have: hubs (`coffees`, `roaster`), links (`cupping_session_coffees`, `roastery_portal_coffee`), one satellite per source never merged across sources, insert-only, two times, supersede. If an analytical layer is ever wanted it goes to BigQuery fed from these tables, and that is where a vault or a star would be modeled.
