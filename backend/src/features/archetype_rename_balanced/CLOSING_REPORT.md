# Closing report — Archetype rename: "Balanced & Sweet" → "Balanced"

Brief: `CLAUDE_CODE_PROMPT_ARCHETYPE_RENAME_BALANCED.md` (Rev 2, 2026-09-19). Build-log entry: `WHAT_WE_BUILT.md` #187. **Nothing committed** (per instruction).

**Test-database note (read this first).** `backend/.env`'s `DATABASE_URL` points at **prod** (`axisandbloom`, via the Cloud SQL Auth Proxy on :5433). Booting the app locally with it would have run the new `schema.sql` against prod before the code shipped. Every boot, test run, discovery query and e2e check below therefore ran against `axisandbloom_test` (the isolated prod clone) via `DATABASE_URL` override. Prod was not touched. Mailchimp was blanked and Resend given a dummy key for the local boots.

## 1. Task 0 — confirmed vs deviated

Confirmed as the brief describes: `catalogReads.ts` (`getArchetypes` 60 s cache, `archetypeLabel`, `archetypeCode`), both `WHERE name = $1` lookups (`routes/quiz.ts`, `services/quizSession.ts`), all backend literals and comments listed, `lint-catalog.mjs` rule 4 scope/allow-list, no admin component hardcoding the label, `schema.sql` seed/Fruity-rename/WHERE-name/VALUES/backfill/view-CASE sites, `newsletter_subscriber.archetype` holding display names, and the non-admin frontend list. `newsletter_subscriber` and its `archetype` column are defined (~L1030–1050) before the seed (L1909), so **both UPDATEs sit together before the seed INSERT** as the brief's default. Two of the five schema DO-blocks are guarded on `quiz` existing (the seed block ~L1983 and the v3 block ~L2126); the v3-scoring and v7 scoring sync blocks run on every boot, which is why the v7 `WHERE name = 'Balanced'` lookup had to change in the same deploy.

Deviations (none material — no stop needed):

| # | Brief said | Actual |
|---|---|---|
| 1 | `git status` clean apart from untracked feature docs | Two tracked files modified before I started, unrelated: `OPEN_TASKS.md`, `launch/60_commerce-and-fulfillment/12_G1_payment_capture_PLACEHOLDER.md`. Left alone. HEAD is `923845e`, a descendant of `16edd2e`. |
| 2 | `npm test` passes (baseline) | **Baseline was not green: 12 failures** — 6 in `src/services/quizScoring.test.ts` and the same 6 in the stale, gitignored `dist/services/quizScoring.test.js`. Cause is unrelated to the name: the tests assume a Q6/Q5/Q3 tie-break cascade, the code uses `[5, 4, 2, 1]`. Not touched (the brief only asks to fix assertions that assert the *old name*). Same 12 fail after the change. |
| 3 | ~110 files in the grep | 113 files at baseline (saved list). |
| 4 | Line numbers | Minor drift only: `FlavorQuiz.tsx` comment L690 → L700, `archetypeNameMapTie` ~L1548 → L1567. |
| 5 | Only two `WHERE name = $1` lookups against `coffee_archetype` in `backend/src` | Confirmed for `$1` lookups. One more name-keyed lookup exists in `schema.sql` (v7 sync loop, `WHERE name = rec.archetype_name`, ~L3212); it is fed by the VALUES rows updated in B1.4, so needed no separate edit. |
| 6 | `cloud-functions/image-optimizer/migrate-assets.ps1` "(comment)" | The line is a **source filename** (`…\BALANCED & SWEET transp.png`), not a comment. Left untouched (filename rule). |
| 7 | Next log number after #183 | The log was already at #186; the entry is **#187**. |
| 8 | Brief expected the seed-row description column to be unchanged | Unchanged. |

## 2. B3 — discovery (dev = `axisandbloom_test`) and the read-only SQL for prod

Run over every `text`/`varchar` column in `public` base tables (jsonb excluded, per brief). Hits **before** the rename:

| table.column | rows | Decision |
|---|---|---|
| `coffee_archetype.name` | 1 | **Updated** (the rename itself) |
| `newsletter_subscriber.archetype` | 33 | **Updated** — a key read by `/api/auth/sync` |
| `quiz_funnel_event.archetype` | 83 | **Left** — append-only analytics event log written by `funnelEvents.ts`; nothing in the app reads it. History stays true to the time. New events will carry `Balanced`, so a `GROUP BY archetype` will show both names until you decide. One-liner if you want it merged: `UPDATE quiz_funnel_event SET archetype='Balanced' WHERE archetype IN ('Balanced & Sweet','Balanced and Sweet');` |
| `coffees.ai_summary` (id 14) | 1 | **Left** — AI-generated customer copy; opens with a `**Balanced & Sweet**` heading. Editorial: re-generate or hand-edit. |
| `coffees.surprise_note` (ids 7, 14) | 2 | **Left** — AI-generated; uses "balanced and sweet" as a generic phrase ("Most people assume … means boring"), which a blind REPLACE would mangle. Editorial. |
| `coffees.three_voice_story` (id 2) | 1 | **Left** — AI-generated prose ("…pulls Balanced & Sweet drinkers in"). Editorial. |
| `coffee_archetype_assignment.notes` (ids 7, 9) | 2 | **Left** — internal cupping notes. |
| `coffee_hop.notes` (id 2) | 1 | **Left** — internal admin note ("Softer acidity → Balanced & Sweet"). |
| `sommelier_messages.content` | 1 | **Left** — historical chat transcript (2026-06-28); never rewrite a customer's transcript. |

I did **not** add blind text UPDATEs for the free-text rows to a boot-time file: rewriting generated marketing copy needs a human read. These are the only ones I'd look at: `coffees` 14 / 7 / 2 (customer-visible) and optionally `coffee_hop` 2 (admin-visible). jsonb snapshots (`quiz_session.context_data`, `api_event.*`, `sommelier_sessions.context_data`, `chat_message.context`, …) left by design; every reader goes through `archetypeCode()` or the FK join. After the rename the same query returns only the rows in the "Left" list.

**Read-only SQL to run against prod** (SELECT only; safe):

```sql
SELECT table_name, column_name, hits FROM (
  SELECT c.table_name, c.column_name,
    (xpath('/row/c/text()', query_to_xml(format(
      'SELECT count(*) AS c FROM %I.%I WHERE %I ILIKE ''%%balanced & sweet%%'' OR %I ILIKE ''%%balanced and sweet%%''',
      c.table_schema, c.table_name, c.column_name, c.column_name), false, true, '')))[1]::text::int AS hits
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    AND c.data_type IN ('text', 'character varying')
) x WHERE hits > 0 ORDER BY table_name, column_name;
```

Prod counts will differ from the clone (the clone is older). If prod shows a column not in the table above, it is new since the clone; tell me and I'll classify it.

## 3. Prod step — none beyond the deploy

The deploy itself performs the rename: `schema.sql` runs at boot and applies the idempotent statements below **before** the archetype seed INSERT (so no 23502). Nothing to run by hand. Exact statements (also in `backend/src/db/migrations/archetype_rename_balanced_2026-09-19.sql`, wrapped in `BEGIN; … COMMIT;`):

```sql
UPDATE coffee_archetype SET name = 'Balanced', updated_at = NOW() WHERE name = 'Balanced & Sweet';
UPDATE newsletter_subscriber SET archetype = 'Balanced'
 WHERE archetype IN ('Balanced & Sweet', 'Balanced and Sweet');
```

Cache: `getArchetypes()` caches 60 s per process, but the rename happens at boot before any request, so there is no stale window; no cache-bust added. Rolling deploy caveat: during the brief window where an old Cloud Run revision is still serving against the already-renamed DB, that old revision's `WHERE name = 'Balanced & Sweet'` lookups return no row (`archetypeId: null` for Balanced results). Short-lived; the new revision is correct.

## 4. Verification (Definition of Done)

| Item | Result |
|---|---|
| `npm run build` backend | clean (exit 0) |
| `npm run build` frontend | clean (vite, exit 0; usual >500 kB chunk warning only) |
| `npm run lint:catalog` | exit 0, no new allow-list entries |
| `npm test` | see §4a |
| Boot 1 against a DB that started with the old row | `coffee_archetype` count 6 → 6; row id `edad524f-e7ba-49c5-90ce-c4f35d508d93` and `code = balanced_sweet` unchanged, name now `Balanced`; 33 `newsletter_subscriber` rows migrated; 65 `quiz_answer_archetype_score` rows intact (v7 sync did not strip Balanced); 0 code-NULL rows; no `[catalog-integrity]` warnings |
| Boot 2 | nothing changed (same rows, `updated_at` unchanged from boot 1, no integrity warnings) |
| Quiz e2e — Balanced run | `POST /api/quiz/score` → `archetype: 'Balanced'`, `archetypeId = edad524f-…` (non-null), scores `{Balanced: 9}` |
| Forced tie | **Not reachable over HTTP:** in the active v7 quiz every answer scores exactly one archetype, so no answer set produces a tie that also exhausts the Q5→Q4→Q2→Q1 cascade. Verified at function level instead: `findWinner(rank({CN:5, Balanced:5, Fruity:5}), {})` → `'Balanced'`, and `archetypeUuid('Balanced')` is non-null. |
| Old-name path | `saveQuizSession(profile, 'Balanced & Sweet', …)` and `'Balanced'` resolve to the **same** `archetypeId`; a `quiz_session` ⨝ `coffee_archetype` join (what `/api/users/profile` and `/api/quiz/results/latest` read) returns `Balanced` for both. Test rows were deleted afterwards. The two authed endpoints themselves were not called over HTTP (Firebase token); they read the FK join above. |
| `GET /api/coffees/archetype-stats?archetype=balanced_sweet` | returns `archetypeLabel: "Balanced"` with its 7 dimension rows. `coffeeCount` is 0 for **every** archetype in the clone (no active coffees there, roastery lifecycle), so I additionally confirmed the view now contains `'Balanced'` (no old name) and that the join CASE matches all 8 current `balanced_sweet` assignments. |
| Liam | one live `chatWithSommelier` exchange about the archetype: reply says "The Balanced archetype sits in comfortable middle ground…", never the old name. Neighbour lookup: `getAdjacentArchetypes` is not exported and the clone's adjacency view is empty, so it takes the code-keyed `FALLBACK_ADJACENCY` (`balanced_sweet → fruity, chocolate_nutty`); both that map and `v_coffee_archetype_adjacency` are keyed on enum codes, which did not change. |

### 4a. Test totals

Baseline (before edits): 12 failed / 333 passed (345 tests, 43 files). After: **12 failed / 344 passed (356 tests, 44 files)** — the identical 12 pre-existing failures (6 in `src/services/quizScoring.test.ts` + the same 6 in the stale gitignored `dist/` copy; tie-break cascade assumptions, unrelated to the name) and nothing new. The +11 passing tests are the new `archetypeCode`/`archetypeUuid` legacy-name cases plus test files picked up by the refreshed `dist/`. Every DB-backed file ran against `axisandbloom_test` after `schema.sql` applied the rename.

## 5. Residual grep — `grep -rIil -E "balanced (&|and|&amp;) sweet" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`

62 files remain (was 113).

| file | reason |
|---|---|
| `CAMILAS_UPDATES.md` | changelog |
| `SOMMELIER_BUILT.md` | changelog |
| `WHAT_WE_BUILT.md` | changelog |
| `WHAT_WE_BUILT_DB.md` | changelog |
| `backend/src/db/migrations/archetype_rename_balanced_2026-09-19.sql` | update-statements |
| `backend/src/db/migrations/bloom_dial_seed_2026_06_23.sql` | history |
| `backend/src/db/migrations/catalog_blueprint_1_2026_09_13.sql` | history |
| `backend/src/db/migrations/v7_final_2026_06_18.sql` | history |
| `backend/src/db/migrations/v7_normalize_2026_06_18.sql` | history |
| `backend/src/db/roasteries notes and conceptual mapping/TASK_3_archetype_assignments.md` | historical |
| `backend/src/db/roasteries notes and conceptual mapping/TASK_4_roaster_blend.md` | historical |
| `backend/src/db/roasteries notes and conceptual mapping/TASK_6_coffee_alias.md` | historical |
| `backend/src/db/schema.sql` | update-statements (+code-backfill arm, comment) |
| `backend/src/db/seeds/_retired/coffee_alias_path_tcr.sql` | history |
| `backend/src/db/seeds/_retired/dial_relationships_base.sql` | history |
| `backend/src/features/ai_agent_liam/SOMMELIER_TASK_1_FOUNDATION.md` | historical |
| `backend/src/features/ai_agent_liam/SOMMELIER_TASK_4_FRONTEND.md` | historical |
| `backend/src/features/archetype_rename_balanced/CLAUDE_CODE_PROMPT_ARCHETYPE_RENAME_BALANCED.md` | historical |
| `backend/src/features/archetype_rename_balanced/CLOSING_REPORT.md` | this-report |
| `backend/src/features/bloom_dial/CLAUDE_CODE_PROMPT_BLOOM_DIAL_CATEGORIES_DB.md` | historical |
| `backend/src/features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md` | historical |
| `backend/src/features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_3_READERS_ONTO_VIEWS.md` | historical |
| `backend/src/features/dial_map_journey/CLAUDE_CODE_PROMPT_DIAL_MAP_JOURNEY.md` | historical |
| `backend/src/features/dial_map_journey/CONCEPT_MOCKUP.html` | historical |
| `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART2_RESULTS_SCREEN_REVEAL_AND_CTAS.md` | historical |
| `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART3_STATUS_CHECK_STALE_PROFILE_AND_BAG.md` | historical |
| `backend/src/features/hoboken_crawl/43-crawl-page-deploy-package/43-crawl-page-handoff.md` | historical |
| `backend/src/features/hoboken_crawl/43-crawl-page-handoff.md` | historical |
| `backend/src/features/hoboken_crawl/CLAUDE_CODE_PROMPT_HOBOKEN_CRAWL.md` | historical |
| `backend/src/features/image_pipeline/IMAGE_ASSET_INVENTORY_AND_PLAN.md` | historical |
| `backend/src/features/image_pipeline/image guid reference/CAMILA_ASSET_GUIDE.md` | historical |
| `backend/src/features/marketing/mailchimp.ts` | legacy-alias |
| `backend/src/features/quizes/CLAUDE_CODE_PROMPT_QUIZ_API_TEST.md` | historical |
| `backend/src/features/quizes/CLAUDE_CODE_PROMPT_QUIZ_BRANCHED_FROM.md` | historical |
| `backend/src/features/quizes/CLAUDE_CODE_PROMPT_QUIZ_COPY_UPDATE_2026-08-15.md` | historical |
| `backend/src/features/quizes/PROMPT_QUIZ_RECOMMENDATION_CACHE.md` | historical |
| `backend/src/features/quizes/QUIZ_V7_MANUAL_TEST_PLAN.md` | historical |
| `backend/src/features/the_axis_page/CLAUDE_CODE_PROMPT_THE_AXIS_V2.md` | historical |
| `backend/src/features/the_axis_page/CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS_R2.md` | historical |
| `backend/src/features/the_axis_page/THE_AXIS_PAGE_COPY.md` | historical |
| `backend/src/features/the_axis_page/THE_AXIS_PAGE_COPY_V2.md` | historical |
| `backend/src/features/the_axis_page/THE_AXIS_PAGE_PROMPT.md` | historical |
| `backend/src/features/the_axis_page/THE_AXIS_REDESIGN_STRATEGY.md` | historical |
| `backend/src/features/the_axis_page/old/axis_method_page_v5_match_plot.html` | historical |
| `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART2_FRONTEND.md` | historical |
| `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART9_ROW_POLISH.md` | historical |
| `backend/src/services/catalogReads.test.ts` | alias-test |
| `backend/src/services/catalogReads.ts` | legacy-alias |
| `backend/src/services/quizSession.ts` | doc-comment |
| `cloud-functions/image-optimizer/migrate-assets.ps1` | filename |
| `frontend/src/app/components/FlavorQuiz.tsx` | legacy-alias |
| `frontend/src/app/components/Shop.tsx` | filename |
| `frontend/src/design/IMAGES/bags/bag-balanced.svg` | asset |
| `frontend/src/features/reveal_panel/PROMPT_block_geometry_unification.md` | historical |
| `frontend/src/features/reveal_panel/PROMPT_dial_polish_content_guard.md` | historical |
| `frontend/src/features/reveal_panel/PROMPT_dial_travel_simplification.md` | historical |
| `frontend/src/features/reveal_panel/PROMPT_edge_doors_and_commerce_ctas.md` | historical |
| `frontend/src/features/reveal_panel/PROMPT_fold_flow_fixes.md` | historical |
| `frontend/src/features/reveal_panel/PROMPT_match_ending_folded_dial.md` | historical |
| `launch/_archive/01_A1_archetype_canon.md` | history |
| `launch/_archive/11_E6_leadad_webhook_OPTIONAL.md` | history |
| `test-mailchimp-tags.mjs` | legacy-alias (+assertion) |

## 6. External follow-ups (not touched — outside the repo)

**(1) Mailchimp — for Dana / Camila.** Live templates, audience merge fields and automations that render or branch on the archetype:
- Live Email #1 / #3 / #5 templates and the archetype-card production email (repo sources are updated under `launch/40_email-marketing/**` and `misc/marketing/**`; the live copies are not).
- The `ARCHETYPE` merge field: `mailchimp.ts` sends the **slug** (`balanced`) via `toArchetypeSlug()`, not the display name, so no audience data needs migrating. **But** several templates branch on display names (`*|IF:ARCHETYPE=Balanced|*`, previously `…=Balanced & Sweet|*`) which never matched the slug in the first place (the slug-branch templates use lowercase `balanced`). The repo sources now read `=Balanced`; when re-pasting into Mailchimp check which comparison each block actually uses. Pre-existing inconsistency, not introduced here.
- Any Mailchimp segment, tag-based automation or subject line that spells out the old name (tags themselves are `archetype:balanced`, unchanged).
- Pre-launch subscribers already in Mailchimp keep whatever text they had; nothing in the app depends on it.

**(2) Image and print assets carrying the old words (design follow-up):**
- `frontend/src/design/IMAGES/bags/bag-balanced.svg` (text "BALANCED & SWEET")
- `frontend/src/design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png`
- `frontend/src/design/IMAGES/lifestyle/ARCHETYPE_Balanced_Sweet01.png`
- `frontend/src/design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun02.png`, `…Jun04.png`, `…Jun09.png` (and any other `WEBCUTBalanced&Sweet*`)
- Roaster pitch deck v4 (`.pptx`)
- Also worth a look: the GCS-served images under `axis-bloom-assets/optimized/archetypes/balanced-sweet/*` and `…/raw/email/archetype-card/balanced-sweet-email.jpg` (used by the match page and the card email) may have the words baked in.

## 7. Files changed

Backend: `services/catalogReads.ts` (+`.test.ts`), `services/quizSession.ts`, `services/quizScoring.ts` (+`.test.ts`), `services/claude.ts`, `services/qrDoor.ts`, `routes/quiz.ts`, `routes/users.ts`, `routes/coffees.ts` (+`.test.ts`), `features/marketing/mailchimp.ts`, `features/marketing/templates/quizCompleteEmail.ts`, `scripts/lint-catalog.mjs`, `db/schema.sql`, `db/seeds/archetype_vectors.sql`, `db/seeds/scoring_v1.sql`, `db/migrations/archetype_rename_balanced_2026-09-19.sql` (new), `features/quizes/Coffee_Quiz_Scoring_v3.csv`, `features/quizes/quiz_v7_content_audit.sql`. Root: `test-mailchimp-tags.mjs`. Frontend: the components listed in #187 plus `bloom/dial/archetypeConfig.ts`, `bloom/dial/BloomDial.tsx`, `bloom/DoorBand.tsx`, `PreLaunch.tsx` (comments), `features/reveal_panel/personal-pages-redesign.html`, `public/match/balanced-sweet/index.html`. Docs/marketing: `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md`, `CAMILAS_UPDATES.md`, `launch/{10,40,50,_source-plans}/…`, `misc/marketing/**`, `misc/design_documents/PACKAGING_PROBLEM_STATEMENT.md`, `misc/revised_dimension_ranges.html`.
