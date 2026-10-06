# Feature: Roastery Portal, part 4 (audit the founders' test, remove "Roasted for", purge all test data)

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-06 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-06. Phase A audit passed (all ten checks), Phase B deployed and verified live (commit 85ceb2e), Phase C purge applied with Dana's explicit approval and verified; see WHAT_WE_BUILT.md #213.
> Depends on: parts 1 to 3 (executed, `WHAT_WE_BUILT.md` #209, #210, #212).

## What this is

Dana and Camila tested the live portal by hand: they opened a link, filled the form, and saved. Before the link goes to a real roastery, three things happen, in this order:

- **A. Audit** (read-only): prove that what they entered landed in the right tables as designed.
- **B. One form change**: remove the "Roasted for" question.
- **C. Purge**: physically delete all portal test data so the form starts clean.

Phase C is irreversible. Dana has pre-approved it on one condition: Phase A passes. If any Phase A check fails, STOP after the audit report and change nothing.

## Decisions already made (Dana, 2026-10-06). Do not re-open.

1. **"Roasted for" is removed** (Camila: it duplicates the brewing questions in section 04). "Where it shines" and "Also good as" stay as they are.
2. **Test data is really deleted, not voided.** This is a one-time exception to the nothing-is-deleted rule, for test data only, because no real roastery has used the portal yet.
3. **Scope of the purge: every portal answer, respondent and link that exists today**, including the links Dana created for Utopian and everything left by the Zzz Test Roastery acceptance runs. After it, no portal link exists; Dana creates a fresh Utopian link when she sends it.
4. **What survives the purge:** Utopian's lineup of ten coffees with their prefills, the lookup lists, the dimension labels, and every catalog coffee.
5. The delete protection (the reject-change triggers from parts 1 to 3) is switched off only inside the purge transaction and is back on before it commits.

## Phase A. Audit (read-only; nothing committed, nothing written)

Run against production. Report everything below in the final report, in plain tables.

1. **Inventory.** Every row in each `roastery_portal_*` table that is not seed or configuration: links (roastery, created, last opened, revoked), respondents (name, email, roastery), lineup coffees with `added_by = 'roaster'`, responses (coffee, version, status, who, when), lineup responses and best sellers, acceptances, note mappings. Also any roastery created in `roaster` since 2026-10-05.
2. **Where each answer landed.** For every response the founders saved, one table: the question on the form → the value they entered → the table and column (or child table) holding it. Cover all six sections, the part 3 questions, and the lineup-level questions.
3. **Checks. Each is pass or fail:**
   - a. Every stored option value exists in its lookup category.
   - b. No orphans: every note, dimension, brew, best-seller and acceptance row points at an existing parent of the same roastery.
   - c. At most one open draft per coffee; versions are consecutive from 1; every submitted row has `submitted_at` and a respondent.
   - d. The four part 3 clearing rules hold in the stored rows (no decaf process on a regular coffee, no blend fields on a single origin, no additive detail without additives, `none` alone in certifications).
   - e. Notes: `rank` is consecutive; every `cupping_note_id` is an active wheel term outside the `Other` category; notes left unmapped are null, not guessed.
   - f. Dimension values are 1 to 5 and only for dimensions the portal asks.
   - g. Nothing from portal activity reached `coffee_archetype_assignment`, any cupping table, `dial_position_signal` or `coffee_hop`, and no `api_event` row exists for an `/api/roastery-portal` path.
   - h. If they pressed Accept on anything: the acceptance row exists, the descriptors are stamped with that response id, `flavor_descriptors_roaster` holds their words in order, only ticked items changed, and the public flavor-wheel endpoint for that coffee returns wheel terms only. If they did not, say so.
   - i. The submit emails were logged for each submit.
   - j. **Purge precondition:** every respondent email belongs to an admin user or to a `Zzz Test` identity, and every response belongs to one of those respondents. A respondent that could be a real roaster fails this check.
4. **Verdict.** "All checks passed" or the list of failures. On any failure: STOP here, report, and do not start Phase B or C.

## Phase B. Remove "Roasted for" (only if Phase A passed)

1. Partner page: remove the question from section 01 and its line from `copy.ts`.
2. Backend: the vocabulary bundle no longer carries the roast-intent list; `saveDraft` no longer accepts or writes `roast_intent`; reads no longer return it; the admin response view and the accept preview no longer show it.
3. Schema: `roast_intent` on `roastery_portal_response` is deprecated in place, the same way `is_decaf` was in part 3: the column stays, nothing reads or writes it. Do not drop the column. The `roastery_portal_roast_intent` lookup rows stay, unused. `v_roastery_portal_progress` no longer counts it toward section 01.
4. Tests updated. `npx tsc --noEmit` clean in backend, no new frontend errors, `vite build` clean, all lints and boot checks green, `schema.sql` applies twice on the test database.
5. Commit, push to `main`, deploy green, startup log clean.
6. Verify live on the Zzz Test Roastery with a fresh test link and a marked `Zzz Test` admin: "Roasted for" is gone from the form and from admin; "Where it shines" and "Also good as" are unchanged; a coffee can still be saved and submitted. Do this BEFORE Phase C so the purge removes these rows too.

## Phase C. Purge (only if Phase A passed and Phase B is deployed)

One-off script, run locally against production through the usual database access. **Do not commit the script** and do not add any delete capability to the service or the admin UI.

1. **Dry run first:** print the row count per table that will be deleted and the count that will remain. Save a JSON snapshot of every row to be deleted to a local file outside git. Report its path.
2. **Apply, in ONE transaction:**
   - Disable, by name, only the reject-change triggers on the portal tables that block the deletes. Not `DISABLE TRIGGER ALL`.
   - If Phase A found test acceptances: delete the `roastery_coffee_descriptors` rows whose `source_response_id` is a response being purged; then, through `catalogService` (not SQL), retire any catalog coffee an acceptance created, and for a coffee that existed before, restore the fields and categories the acceptance changed from the `applied` before-values. Catalog coffees are retired, never deleted.
   - Delete, children first: best sellers, lineup responses, response notes, dimensions, brews, acceptances, responses, note mappings, respondents, links.
   - Delete lineup coffees that have `added_by = 'roaster'`, and all lineup rows of the Zzz Test Roastery.
   - Keep every other lineup row (Utopian's ten) exactly as it is.
   - Re-enable every trigger that was disabled. Commit only if all of the above succeeded.
3. **After commit, verify and report:**
   - Row counts: zero in links, respondents, responses and their child tables, lineup responses, best sellers, acceptances and note mappings.
   - Utopian's lineup: ten active coffees, prefills unchanged (compare to the Phase A inventory), all "Not started" in `v_roastery_portal_progress`.
   - Every portal trigger is enabled again (`pg_trigger.tgenabled`), and an UPDATE on a submitted row is still rejected (prove it on the test database, not in production).
   - The purged links return the "not active" page.
   - Boot integrity checks and the catalog integrity endpoint are green.
4. Demote and disable the `Zzz Test` admin used in Phase B. Leave the Zzz Test Roastery inactive.

## CONSTRAINTS

- Phase A is read-only. Phase C touches only the tables listed. No other table is deleted from, in particular not `api_event`, `transactional_email_log`, `catalog_change`, `coffees`, or anything customer-side.
- Do not act as Dana or any real person.
- Do not create a link for Utopian or any real roastery.
- If the Phase C dry run shows a row that does not fit the scope in decisions 3 and 4, STOP and report before applying.

## DONE = Phase B commits pushed to `main`, deploy green, startup log clean; Phase C applied and verified; `WHAT_WE_BUILT.md` and `WHAT_WE_BUILT_DB.md` entries (the DB entry records the one-time purge: date, tables, row counts, and that the triggers were re-enabled); Status above flipped. One report at the end, with the Phase A audit first.
