# Claude Code Prompt — Archetype rename: "Balanced & Sweet" → "Balanced"

**Rev 2 (2026-09-19).** Rewritten after the Catalog Blueprint series (briefs 1–5b, `f4a9685` … `1f10dc4`) landed. Rev 1 (2026-09-14) predates it and is superseded; if you find a copy, ignore it.

**Standalone brief.** Not part of the Catalog Blueprint series. Runs on the current tree (`16edd2e` or a descendant). Commit on its own.

**Goal:** the archetype the site, the quiz, the emails, Liam and the admin currently call "Balanced & Sweet" is called "Balanced" everywhere a person can read it, and the database row agrees. Nothing else about the archetype changes: same UUID, same enum code `balanced_sweet`, same URL `/match/balanced-sweet`, same colour `#d1ac11`, same description text, same scoring, same neighbours.

**Why this needs care (context, not instructions):** since brief 3 nearly every backend label comes live from `v_coffee_archetype` through `catalogReads.archetypeLabel()` / `archetypeCode()`, so most of the rename is one row. But the display name is still a natural key in the quiz subsystem, which brief 3 deliberately left alone: `coffee_archetype.name` is `UNIQUE`, the scoring query returns `archetype_name`, `quizScoring.findWinner` returns the literal string as the tie fallback, and `routes/quiz.ts` L163 + `services/quizSession.ts` L22 resolve the winner with `SELECT id FROM coffee_archetype WHERE name = $1`. `schema.sql` runs at every boot (`index.ts` ~L144). Its archetype seed is `INSERT … SELECT … WHERE NOT EXISTS (name)` and `code` is `NOT NULL` (brief 5a hotfix `e0069ad`): rename the prod row without changing the seed in the same deploy and the next boot tries to insert a new "Balanced & Sweet" row with `code = NULL` and fails 23502 at startup. So the row rename, `schema.sql`, and the code land together, and `schema.sql` already contains the precedent: `UPDATE coffee_archetype SET name = 'Fruity' … WHERE name = 'Fruity & Complex'` (L1921).

**Decisions already made (Dana, 2026-09-14) — implement as stated, don't re-open:**

- Display name becomes exactly `Balanced` (capital B, no suffix).
- Enum code `balanced_sweet`, URL slug `/match/balanced-sweet`, Mailchimp slug `balanced`, image filenames, CSS/variable names all stay. No redirects, no enum migration.
- Historical Claude Code briefs, closing reports, one-shot files under `db/migrations/` and `db/seeds/_retired/` stay untouched. The living docs (`WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md`, `CAMILAS_UPDATES.md`) are updated.
- Email/marketing template sources in the repo (`launch/40_email-marketing/**`, `misc/marketing/**`) are updated. The live Mailchimp templates are external and NOT touched; the closing report lists them for Dana/Camila.
- Image and print assets with the words baked in are NOT edited (`bag-balanced.svg`, `BALANCED & SWEET transp.png`, `ARCHETYPE_Balanced_Sweet01.png`, `WEBCUTBalanced&Sweet*.png`, the roaster deck `.pptx`). The closing report lists them as a design follow-up.
- Old-name inputs keep working: anything that still arrives as `Balanced & Sweet` / `Balanced and Sweet` (older `newsletter_subscriber` rows, older `quiz_session.context_data`, an old Mailchimp merge value, a cached client) must resolve to the same archetype, never to `null`.
- One deploy does everything: the row rename and the legacy-data sweep run from `schema.sql` at boot (idempotent). The migration file is the standalone record of the same statements, not a separate prod step.

## Task 0 — Verify current state (confirm, don't assume)

Report each as confirmed or deviated before editing anything.

- `git log -1` is `16edd2e` or a descendant; `git status` clean apart from untracked feature docs. `npm run lint:catalog` exits 0 and `npm test` passes (record the baseline).
- `grep -rIil -E "balanced (&|and|&amp;) sweet" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist` — save the list; it is the checklist for Part D and the Definition of Done. Expect ~110 files, most of them `.md`.
- Backend code that still carries the literal (everything else was moved onto the view by brief 3): `services/quizScoring.ts` L29 (`return 'Balanced & Sweet';`) · `services/claude.ts` L12 (Liam system prompt) · `features/marketing/templates/quizCompleteEmail.ts` L53 · `features/marketing/mailchimp.ts` L32/L41–42 (comment + legacy aliases, keep) · comments only in `routes/quiz.ts` L66/L135, `services/quizSession.ts` L4, `routes/users.ts` L22–23, `routes/coffees.ts` L569, `services/qrDoor.ts` L276 · tests `services/quizScoring.test.ts` L11/L53/L58, `routes/coffees.test.ts` L131–133 (comments) · `scripts/lint-catalog.mjs` L229 (`LABELS` array).
- Name-keyed lookups: `routes/quiz.ts` L163 and `services/quizSession.ts` L22, both `SELECT id FROM coffee_archetype WHERE name = $1`. Confirm no other `WHERE name = $1` against `coffee_archetype` exists in `backend/src`.
- `services/catalogReads.ts`: `getArchetypes()` (60 s cache, rows carry `code`, `label`, `uuid`), `archetypeLabel(code)`, `archetypeCode(labelOrCode)` (case-insensitive on label, passthrough on code).
- `scripts/lint-catalog.mjs` rule 4: `LABELS` L229 includes `'Balanced & Sweet'`; scope `routes/`, `services/`, plus `frontend/src/app/components/admin/**`; allow-list `services/quizScoring.ts`, `services/quizIntegrity.ts`. Confirm no admin component still hardcodes the label (`AdminInventory.tsx` moved to `useArchetypes()` in brief 4).
- `db/schema.sql`: seed L1909–1918 (`WHERE NOT EXISTS`), Fruity rename L1921, `WHERE name = 'Balanced & Sweet'` at L1986, L2048, L2129, L2835, L2980; quiz answer/score VALUES rows carrying the name at ~L2077–2094, L2208–2226, L2905–2919, L3193–3205; the one-time `code` backfill CASE at ~L2401 (`WHERE code IS NULL`); the archetype-stats view's JOIN CASE at ~L3277 (`CASE aa.archetype WHEN 'balanced_sweet' THEN 'Balanced & Sweet' … END = a.name`, feeds `GET /api/coffees/archetype-stats`). Note which of the five DO-blocks are guarded by `IF (NOT) EXISTS (SELECT 1 FROM quiz …)` and which run on every boot: the v7 scoring sync (~L2960–3210) is self-healing and deletes score rows it does not list, so a NULL `v_bal_id` there would strip the Balanced scores.
- `newsletter_subscriber.archetype` is a text column holding display names (`routes/auth.ts` ~L63–71 reads it and passes it to `saveQuizSession`). This is the main place old-name data lives in prod. `quiz_session.context_data` is jsonb with an `archetype` key (history; readers use the FK join).
- Frontend (non-admin, still hardcoded by design; brief 4 only moved admin onto `useArchetypes()`): `coffee-info/archetypeConstants.ts` L3 (`ARCHETYPE_LABEL`, consumed by `archetypeVectors.ts`, `useCompatibility.tsx`, `CoffeeStoryPage.tsx`, `profile/ActivityTimeline.tsx`, `profile/WorthExploring.tsx`) · `axis/AxisMap.tsx` L52 · `TheAxis.tsx` L19 · `TheAxisV1.tsx` L9, L19 · `Home.tsx` L52 · `About.tsx` L16 · `HowItWorks.tsx` L54 · `Shop.tsx` L59 (L9 is an image import path, stays) · `FlavorQuiz.tsx` L395–396, L468, L472, L690, ~L1548 · comments in `PreLaunch.tsx` L19, `bloom/dial/archetypeConfig.ts` L114, `bloom/DoorBand.tsx` L21, `bloom/dial/BloomDial.tsx` L577/L900 · `frontend/public/match/balanced-sweet/index.html` · `frontend/src/features/reveal_panel/personal-pages-redesign.html`.

## Part A — Quiz subsystem: stop keying on the display name, tolerate the old one

**A1. `services/catalogReads.ts` — legacy labels resolve in `archetypeCode()`.** Add, next to the function, a small map of retired labels to codes (keys lower-case, values codes, so lint rule 4 never sees a label literal):

```ts
// Display names that older rows, emails or clients may still send. Codes, not labels,
// on the right-hand side: archetypeCode() is the only place a legacy name is understood.
const LEGACY_LABEL_TO_CODE: Record<string, ArchetypeCode> = {
  'balanced & sweet': 'balanced_sweet',
  'balanced and sweet': 'balanced_sweet',
  'fruity & complex': 'fruity',
};
```

`archetypeCode()` checks code → live label (case-insensitive, as now) → `LEGACY_LABEL_TO_CODE[trimmed.toLowerCase()]` → `null`. Add a helper `archetypeUuid(labelOrCode): Promise<string | null>` that returns `getArchetypes()` row `.uuid` for the resolved code (the view already exposes `uuid`).

**A2. Replace the two name lookups.** `routes/quiz.ts` L163 and `services/quizSession.ts` L22: `archetypeId = await archetypeUuid(name)` instead of `SELECT id FROM coffee_archetype WHERE name = $1`. Behaviour is identical for canonical names and now also correct for legacy names. Update the doc comment at `quizSession.ts` L4.

**A3. Tie fallback.** `services/quizScoring.ts` L29 → `return 'Balanced';`. It stays on rule 4's allow-list (the literal is the function's job, as the lint's own comment says). Fix the two comments in `routes/quiz.ts` (L66, L135). Tests in `quizScoring.test.ts`: `BS = 'Balanced'`, test names updated; add one test that `archetypeCode('Balanced & Sweet')` and `archetypeCode('Balanced')` both return `'balanced_sweet'` (DB-backed test, next to the existing `catalogReads.test.ts` cases) and one that `archetypeUuid('Balanced & Sweet') === archetypeUuid('Balanced')`.

**A4. Lint.** `scripts/lint-catalog.mjs` L229: `'Balanced & Sweet'` → `'Balanced'` in `LABELS`. Do not add the legacy string back anywhere in the lint. Run `npm run lint:catalog` after Part C; it must exit 0 with no new allow-list entries.

**A5. Other backend literals.** `services/claude.ts` L12 → `- Balanced: caramel, honey, milk chocolate, round body`. `features/marketing/templates/quizCompleteEmail.ts` L53 → `displayName: 'Balanced'` (the file is under `features/`, outside rule 4's scope; leave it a literal, that is how the other five are done there). `features/marketing/mailchimp.ts`: no functional change (`'balanced'` is already in `ARCHETYPE_SLUGS`); update the comment at L32 and keep the two aliases at L41–42. `test-mailchimp-tags.mjs` L53 → `'Balanced'`, keep one assertion that `'Balanced & Sweet'` still slugs to `balanced`. Comments: `routes/users.ts` L22–23, `routes/coffees.ts` L569, `services/qrDoor.ts` L276, `routes/coffees.test.ts` L131–133.

## Part B — Database: row, seed, lookups, legacy data

**B1. `schema.sql` (boot-safe, idempotent):**

1. Immediately BEFORE the archetype seed INSERT (L1909), mirroring the Fruity precedent at L1921:
   ```sql
   -- Rename 'Balanced & Sweet' → 'Balanced' in existing DBs (2026-09-19, idempotent).
   -- Must run BEFORE the seed below: with code NOT NULL, a WHERE NOT EXISTS miss on the
   -- old name would try to insert a code-less row and fail 23502 at boot.
   UPDATE coffee_archetype SET name = 'Balanced', updated_at = NOW() WHERE name = 'Balanced & Sweet';
   -- Legacy display-name data (pre-launch subscribers claimed their match by name).
   UPDATE newsletter_subscriber SET archetype = 'Balanced'
    WHERE archetype IN ('Balanced & Sweet', 'Balanced and Sweet');
   ```
   The `newsletter_subscriber` UPDATE must sit after that table's `CREATE TABLE IF NOT EXISTS`; if that is later in the file than L1909, place this second UPDATE right after the table's definition instead and say so in the report.
2. Seed row L1912 becomes `('Balanced', 'A smooth, round, and approachable profile. …')`, description unchanged.
3. Every `WHERE name = 'Balanced & Sweet'` (L1986, L2048, L2129, L2835, L2980) → `'Balanced'`.
4. Every quiz answer/score VALUES row that carries `'Balanced & Sweet'` as the archetype name (~L2077–2094, L2208–2226, L2905–2919, L3193–3205) → `'Balanced'`. Answer texts do not change.
5. The one-time `code` backfill at ~L2401 (`UPDATE coffee_archetype SET code = CASE name … WHERE code IS NULL`): add `WHEN 'Balanced' THEN 'balanced_sweet'`, keep the `'Balanced & Sweet'` arm (a fresh DB seeded from an older dump still gets its code).
6. The archetype-stats view JOIN CASE at ~L3277: `WHEN 'balanced_sweet' THEN 'Balanced'`. This is a join condition, not a label: left as is, the view silently drops every Balanced row once the name changes. Grep `schema.sql` for any other `CASE … WHEN 'balanced_sweet' THEN '` used as a join or filter and treat it the same way (the ones at ~L2419/L2424/L2440 map to numbers and arrays, not names, and stay).
7. Comments (L2195, L2900 and similar) → `'Balanced'`.

**B2. Migration file** `db/migrations/archetype_rename_balanced_2026-09-19.sql` (convention of `catalog_blueprint_5b_2026-09-16.sql`: runnable standalone, idempotent, commented): the same two UPDATEs as B1 step 1, plus one UPDATE per extra column found in B3, inside `BEGIN; … COMMIT;`. Header comment states that `schema.sql` applies the same statements at boot and this file exists for a manual run against a DB the app does not boot against.

**B3. Discovery query (run against the dev DB; the closing report includes the SQL so Dana can run it read-only on prod):** a DO-block or script over `information_schema.columns` for every `text`/`varchar` column in `public`, counting rows where the column ILIKE `'%balanced & sweet%'` or `'%balanced and sweet%'`. Exclude jsonb (`quiz_session.context_data`, `api_event` payloads): snapshots are history and every reader goes through `archetypeCode()` or the FK join. List every column with a non-zero count; add an UPDATE to B1/B2 for the ones that are keys or displayed text (e.g. any Liam knowledge / archetype copy tables, `transactional_email_log` subjects if present). Report the ones you deliberately left alone and why.

**B4. Seeds that may be re-run** (`db/seeds/`, not boot-time): `archetype_vectors.sql` (8 rows keyed by name), `scoring_v1.sql` (name lookup + 5 rows) → `'Balanced'`. `db/seeds/_retired/**` stays untouched.

**Do not edit** `db/migrations/v7_*.sql`, `bloom_dial_seed_2026_06_23.sql`, `catalog_blueprint_*.sql`: one-shot history.

**Cache note for the report:** `getArchetypes()` caches for 60 s per process. On deploy the rename happens at boot before any request, so no stale window; say so in the report rather than adding a cache-bust.

## Part C — Frontend labels and copy (non-admin pages, hardcoded by design)

`coffee-info/archetypeConstants.ts` L3 · `axis/AxisMap.tsx` L52 · `TheAxis.tsx` L19 · `TheAxisV1.tsx` L9, L19 · `Home.tsx` L52 · `About.tsx` L16 · `HowItWorks.tsx` L54 · `Shop.tsx` L59 (the L9 import path `'BALANCED & SWEET transp.png'` stays: filename) · `FlavorQuiz.tsx` L395–396 (keep both legacy keys, add `'Balanced': 'balanced'`), L468, L472 (copy: "Balanced coffees are soft and approachable…"), L690 (comment), ~L1548 (`balanced: 'Balanced'`) · comments in `PreLaunch.tsx` L19, `bloom/dial/archetypeConfig.ts` L114, `bloom/DoorBand.tsx` L21, `bloom/dial/BloomDial.tsx` L577/L900 · `frontend/src/features/reveal_panel/personal-pages-redesign.html` · `frontend/public/match/balanced-sweet/index.html` (title, OG tags, visible text; the path stays) · `cloud-functions/image-optimizer/migrate-assets.ps1` (comment).

Admin components (`frontend/src/app/components/admin/**`) need nothing: they read `useArchetypes()`. Confirm with a grep and say so.

Copy rule for prose: replace the name, then re-read the sentence. "Balanced & Sweet's mustard field" → "the Balanced field" in customer-facing copy; possessive is fine in comments. Do not add the word "Sweet" back anywhere as a compensating adjective.

## Part D — Docs and marketing sources

- `WHAT_WE_BUILT.md`: occurrences → `Balanced`, plus a build-log entry (next number after #183) "Archetype rename: Balanced & Sweet → Balanced" stating: display-name-only change, code/slug unchanged, the boot-safe UPDATEs in schema.sql, legacy labels resolved in `archetypeCode()`, the quiz lookups moved off `WHERE name`, the lint `LABELS` update, and the external follow-ups (Mailchimp templates, image assets).
- `WHAT_WE_BUILT_DB.md`: occurrences → `Balanced`; in the `coffee_archetype` section note that `name` is still the natural key inside the quiz seed blocks, and that `archetypeCode()` is the only accepted way to turn an inbound name into a key.
- `SOMMELIER_BUILT.md`, `CAMILAS_UPDATES.md`: occurrences → `Balanced`.
- `launch/40_email-marketing/**` (the `.md` wiring docs, `resend/quiz-complete-source.html`, `sendready/31-mailchimp-email-production.READY.html|.txt`, `templates/email1|3|5.html|.txt`, `WELCOME_EMAILS_DRAFT_v3.md`) and `misc/marketing/**` (the duplicate `templates/`, and the `You're __ARCHETYPE__…/` production files): visible text → `Balanced`; where a template branches on the slug `balanced`, leave the slug. Also `launch/10_quiz-and-archetypes/01_A1_archetype_canon.md`, `launch/50_ads-and-social/11_E6_leadad_webhook_OPTIONAL.md`, `launch/_source-plans/MARKETING_TECH_PLAN.md`, `misc/design_documents/PACKAGING_PROBLEM_STATEMENT.md`, `misc/revised_dimension_ranges.html`.
- Leave `launch/_archive/**` alone.
- `backend/src/features/quizes/Coffee_Quiz_Scoring_v3.csv` and `quiz_v7_content_audit.sql`: reference data for the quiz, update for consistency.
- The other historical `.md` files under `backend/src/features/**` (past briefs, closing reports, strategy docs, the Catalog Blueprint README) stay as they are.

## Don'ts (scope fence)

- No change to `archetype_enum`, `coffee_archetype.code`, any slug, route path, filename, or image.
- No new label maps anywhere; no new allow-list entries in `lint-catalog.mjs`; no touching `catalogService.ts`.
- No edits to `db/migrations/*` (other than the new file), `db/seeds/_retired/**`, `launch/_archive/**`, historical briefs or closing reports.
- Do not remove the legacy aliases from `archetypeCode()`, `mailchimp.ts` or `FlavorQuiz.tsx`; they are the compatibility layer for old data.
- No new npm dependencies.

## Definition of done

- `npm run build` clean (backend and frontend). `npm run lint:catalog` exits 0. `npm test` green, or the same pre-existing failures as the Task 0 baseline and nothing new; if a pre-existing failure was asserting the old name, fix the assertion, not the code.
- `grep -rIil -E "balanced (&|and|&amp;) sweet" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist` returns ONLY: the legacy-alias lines in `catalogReads.ts`, `mailchimp.ts`, `FlavorQuiz.tsx`, `test-mailchimp-tags.mjs`; the UPDATE statements and the code-backfill arm in `schema.sql` and the new migration; the test asserting the legacy alias; files under `db/migrations/*`, `db/seeds/_retired/**`, `launch/_archive/**`; historical briefs/closing reports/strategy docs; binary and image assets; `Shop.tsx` L9. Paste the full remaining list in the closing report with a one-word reason per file.
- Local boot twice in a row against a DB that started with the old row: boot 1 leaves `SELECT count(*) FROM coffee_archetype` unchanged and the row named `Balanced` with its original `id` and `code`; boot 2 changes nothing; `[catalog-integrity]` clean.
- Quiz end to end on local: a run that lands on Balanced returns `archetype: 'Balanced'` with a non-null `archetypeId`; a forced tie with no cascade answer resolves to `Balanced` with a non-null id; `GET /api/users/profile` and `/api/quiz/results/latest` show `Balanced`; `GET /api/coffees/archetype-stats` still returns a Balanced row.
- `saveQuizSession(profileId, 'Balanced & Sweet', …)` (an old `newsletter_subscriber` row via `/api/auth/sync`) resolves to the same `archetypeId` as `'Balanced'`.
- Liam: one sommelier exchange whose answer mentions the archetype says "Balanced"; the neighbour lookup for `balanced_sweet` still returns fruity and chocolate_nutty.
- Closing report: Task 0 deviations; the B3 discovery output (dev) and the read-only SQL for prod; the columns updated vs. left alone; confirmation that no separate prod step is needed beyond the deploy (and the exact statements in the migration file for the record); the residual grep list; and the two external follow-up lists: (1) Mailchimp live templates / audience merge fields / automations that render the archetype name (for Dana/Camila), (2) image and print assets carrying the old words (`bag-balanced.svg`, `new bags mock up/BALANCED & SWEET transp.png`, `lifestyle/ARCHETYPE_Balanced_Sweet01.png`, `photos/june2026/WEBCUTBalanced&Sweet*.png`, roaster pitch deck v4).
