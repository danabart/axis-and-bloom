# Closing report — Website 7A, Find my flavor: shell, entry and question scenes

**Status: shipped** (`WHAT_WE_BUILT.md` #258). Task 0 found no contradiction with the brief, only findings F1–F4, which decided how Part A and Part B are built. The run went through to push, deploy, `catalog:md`, the startup log and the production smoke; evidence is at the end.

Read for Task 0:
- `DEVELOPMENT_GUARDRAILS.md` and `CLAUDE.md` (both unchanged since `3b7f084`) and the brief.
- Workstream `README.md` (merge rule, D6, D11, D15) and `HANDOFF_SURVEY_2026-11-04.md` §5.
- `source/flavor-b/build.py` (all 149 lines) and `FlavorQuiz.tsx` (all 2124 lines).
- `routes/quiz.ts` (`/questions`, `/branch`), the quiz content block of `schema.sql` (V7 seed, SCD2 Parts A–E), and the `quiz_question` comments in `comments.sql`.
- `services/quizIntegrity.ts`, `design/assets.ts` and `Navigation.tsx`.

## Task 0.1 — behaviour inventory (`FlavorQuiz.tsx` at `05bdec5`)

Each line: what it does today, then what 7A does with it. 7B owns the result screens; nothing there changes here beyond token colours.

| # | Behaviour | Where (line) | 7A |
|---|---|---|---|
| 1 | **Data fetch:** `GET /api/quiz/questions` (r.ok checked) → `questions`; retry via `loadQuestions` | 664–683 | kept; the scene renders `questions[step]`, N answers, the real total |
| 2 | **Score:** `POST /api/quiz/score` with `answerIds = Object.values(selectedIds)`; unknown archetype → `scoreError` | 1043–1075 | kept (state machine untouched) |
| 3 | **Branch:** `GET /api/quiz/branch?archetypeId=` → `showBranch`; the branch answer resolves the final archetype | 1080–1090, 1165–1208 | kept; the branch renders as scene N+1 in the same component |
| 4 | **Tie:** `tieDetected` → interstitial: "Talk to Liam" (`hasLiamAccess`, not gated) / "See my primary result" (`quiz_final` + save) | 1077, 1811–1862 | kept; restyled as a scene |
| 5 | **Save:** `saveQuizResult(buildQuizResultPayload…)` at three call sites (no branch, branch, tie); `refreshUserProfile` after | 1101, 1194, 1850 | untouched |
| 6 | **Session key:** `crypto.randomUUID()` per mount, renewed on retake | 553, 1141 | untouched |
| 7 | **Funnel:** `QuizStart` + `quiz_start` on the first answer of question 1 (once); `QuizComplete` + `quiz_complete` (pre-branch score); `quiz_final` (no branch / branch / tie); `EmailSubmitted` + `email_submitted` (guest gate, signed-in auto-subscribe). Every call carries `{campaign, vid}` from `getActiveCampaign()` | 1155–1157, 1059–1061, 1098 / 1188 / 1848, 879 / 933 | untouched; asserted in tests (no FlavorQuiz test existed before, so the expectations are taken from this code) |
| 8 | **Campaign fast-start:** `?campaign=<CAMPAIGNS key>` skips entry to question 1, except a recognized returning user (waits for the profile fetch) | 970–983 | kept |
| 9 | **`?retake=1`:** after the profile fetch, a matched user is reset and sent to question 1; the URL is cleaned | 1218–1232 | kept |
| 10 | **`?result=<key>`:** preview straight to the result | 541–545 | kept (7B) |
| 11 | **Name prefill:** `sessionStorage axisBloomCustomerName` (Home's capture) sets the name and skips entry; the key is removed | 950–957 | kept |
| 12 | **Profile prefill:** a signed-in user with no archetype → first name from the profile and straight to questions | 692–699 | kept |
| 13 | **Signed-in entry line:** "Signed in as {email} · profiling yourself or someone in your household" replaces the sign-in link | 30–31, 1543 | kept on the new entry scene |
| 14 | **Returning user:** signed in with an archetype and not started → Welcome back, primary profile, last quiz date, description, folded dial (+ Worth exploring, adjacent block), "More you can do" row (Retake, Liam with access, profile, FI, household), `CompareOverlay`, `FloatingCart` | 1265–1497 | header on the entry photo (Welcome back + saved archetype + retake); the dial blocks and the link row follow below, unchanged |
| 15 | **Prelaunch:** the returning user sees the sealed "Your match is waiting" (retake kept); the result is the sealed ending (email card / "on its way to {email}") | 1284–1318, 1869–1896 | logic untouched; colours moved to tokens |
| 16 | **Wrap ceremony:** `WrapOverlay` between the last answer and the result (papers, "Wrapping {name}'s coffee…", reduced-motion path) | 196–325, 2090–2098 | kept; colours to tokens only |
| 17 | **Back:** "← BACK" on questions 2+, clears the pending auto-advance | 1750–1754 | kept, as the B-style "← Back" in `Caps` top-left; selection remembered (`answers[step]`) |
| 18 | **Save progress / Exit ×:** `QuizHeader`; "Save progress" for guests → `/sign-in`; "Exit ×" → `/` | 113–143 | moved into the progress bar; "Exit ×" → the entry scene, with an in-design confirm when answers exist (brief) |
| 19 | **Auto-advance:** 750 ms | 1162, 1206 | 420 ms (the handoff's value, brief Part B) |
| 20 | **Progress:** `ProgressTicks total={7}`, typed | 1702 | the progress bar uses `questions.length` (fixes the typed 7; the live quiz has 6, D15) |
| 21 | **Highlights:** `Q_HIGHLIGHTS` per question + `BRANCH_HIGHLIGHT`, `highlightQuestion()` | 330–353 | retired (brief) |
| 22 | **Question images:** `QUESTION_IMAGES[q_number]` from `quizAssets.pic1..6` | 55–60, 379–386 | retired; `quiz_question.image_asset_key` (data) |
| 23 | **7B keeps:** `PostQuizEmailGate`, `ShareMatchRow`, end action row, result hero, Worth exploring, `CompareOverlay` | 1869–2088 | untouched |
| 24 | **`FloatingCart`:** rendered on this route (not gated) since the Part 21 fix of 2026-08-09; the brief says "absence", but the code renders it | 1486, 2113 | kept as it is (see finding F3) |
| 25 | **Footer:** none, only a Privacy · Terms line under the result | 2101–2110 | kept |
| 26 | **Loading / error:** "Loading…"; "We couldn't load the quiz. Tap to try again." + "Try again" (`loadQuestions`) | 1235–1262 | restyled as scenes on the entry photo; same retry |
| 27 | **Begin without a name:** disabled today | 1580–1590 | enabled (brief); the name stays optional |

## Task 0.2 — the handoff (`flavor-b/build.py`)

- **Entry scene:** `axis-bowl.jpg` behind a dark wash (`rgba(26,24,22,.78→.12)`), caps "Find my flavor", h1 "Whose palate are we profiling today?", a lead with "Seven questions… never a flavor to name", a name field, "Begin my profile ↗", "Already have a profile? Sign in", and a bottom bar "No wrong answers. We listen for moments, not flavor words. · Free · about three minutes".
- **Question scene:** a photo with a slow drift (18 s), "01 / 07", h2, four rows (letter, text, arrow on hover), a hover indent, the selected row underlined, auto-advance after 420 ms.
- **Progress bar:** the name ("{Name}'s profile" / "Your profile"), seven 2 px segments, and "Exit ×". It replaces the header during questions.
- **Photos per scene:** entry `axis-bowl.jpg`; questions `shop-DSC_3942`, `shop-DSC_3988`, `shop-DSC_3902`, `shop-IMG_0479`, `shop-DSC_3886`, `shop-IMG_0435`, `axis-cupping`; result `scan-chocolatenutty.jpg`.
- **Not in the design:** back, keyboard, ARIA, branch, tie, returning user, gate, loading and error. These are drawn in B's style (brief).

## Task 0.3 — quiz content tables

- **`quiz_question`:** SCD2 (`valid_from`, `valid_to`, `is_current`; one current row per `(quiz_id, q_number)`).
  - **Writer:** `seed` only, running as the owner. There is no admin content door, so there is nothing to extend.
  - **Request pool:** SELECT only, enforced by `quizIntegrity` check 16.
- **Finding F1, the guard.** `quiz_content_guard()` (`schema.sql` Part E) refuses every in-place UPDATE of a current row except retiring it. Its one exemption is filling `answer_code` / `sort_order` on `quiz_answer` while they are NULL.
  - As written, the brief's seed `UPDATE … SET image_asset_key … WHERE image_asset_key IS NULL` would be refused at boot.
  - The brief's decision ("a new column on a versioned table is additive and does not open a new version") is kept by the same mechanism the guard already uses: `image_asset_key` may be filled on a current `quiz_question` row **while it is NULL**, and every other change stays refused. A photo is presentation, not content anyone answered against, so a different photo is a bucket swap at the same key, never an edit.
  - A future question version starts with a NULL key, and the seed fills it at the next boot.
- **Finding F2:** the Guardrails line says "the two `quiz_question` columns", while Part A adds one (`image_asset_key`). One column is added, as Part A specifies.
- **Questions:** the main quiz `v7` has six current questions; the branch quizzes `v7-branch-floral`, `v7-branch-earthy` and `v7-branch-balanced` each have one.

## Task 0.4 — registry

- **Today:** `quizAssets` holds `pic1..6` and `coffeeLarge`, all live (`optimized/quiz/…`); `quizResultAssets` holds the result scans.
- **Added:** `quizSceneAssets.entry` (`quiz/scene-entry`) and `quizSceneAssets.result` (`quiz/scene-result`; used by 7B).
- **Question photos are data:** `quiz/scene-q1` … `quiz/scene-q6` and `quiz/scene-branch`, resolved by `optimizedAsset()`. Until a photo is uploaded, the question falls back to the entry photo, and the entry photo to the current `quizAssets.coffeeLarge`.
- **Upload rows** are appended to `MEDIA_MAP.json` (brief 7A); the upload itself runs through the media brief's script after this deploy.

## Finding F3

`FloatingCart` is rendered on `/find-my-flavor` (the Part 21 fix, 2026-08-09, "Add to Cart silently updated … with zero visible confirmation"). The brief's inventory line "`FloatingCart` absence on this route" describes an older state. 7A keeps the code's behaviour; it only shows on the returning-user and result screens, where something can be added.

## Finding F4

The live main quiz has 6 questions; the handoff draws 7 with 7 photos. The first six handoff question photos go to `q_number` 1–6 in order. The seventh (the cupping bowl, the handoff's "last sip" question) goes to the branch scene, which is the quiz's "one more" step. This is a layout mapping, not content; Camila can swap any photo at its key.

---

## What was built

**Part A (schema):**
- `quiz_question.image_asset_key TEXT NULL`, with its comment.
- The seed (after the V7 seed): the current main-quiz questions take `quiz/scene-q<n>` and the branch questions `quiz/scene-branch`, `WHERE image_asset_key IS NULL`.
- `quiz_content_guard()`: the F1 exemption, in the same shape as its `answer_code` one.
- `GET /api/quiz/questions` returns `image_asset_key`; `/branch` returns `imageAssetKey`.
- G2.5: the writer stays `seed`; there is no admin content door to extend.

**Part B (frontend):** `components/quiz/QuizScenes.tsx` + `quiz.css`, and in `FlavorQuiz.tsx` only the render branches are replaced (inventory #1–#27):
- **Entry scene** on the entry photo, with `Navigation tone="paper" floating`.
- **Question scene:** N rows lettered A…, `role=radiogroup`/`radio`, roving focus, letter keys, ↑/↓, an `aria-live` counter, the selection remembered on Back, 420 ms auto-advance.
- **Progress bar:** "{Name}'s profile" / "Your profile", `questions.length` segments, "Save progress" (`!user`, as before), "Exit ×" with the in-design `ExitConfirm` when answers exist.
- **Branch** as scene N+1 ("One more"). **Tie scene** (the `seeTiePrimary` logic moved out of the JSX unchanged).
- **Loading / error** scenes ("Try again" reruns `loadQuestions`); on a score error, "Try again" reruns scoring.
- **Returning-user header** on the entry photo; **sealed returning** scene; colour tokens on the wrap ceremony and the sealed ending.
- **Retired:** `QUESTION_IMAGES`, `Q_HIGHLIGHTS` / `BRANCH_HIGHLIGHT` / `highlightQuestion`, and `ProgressTicks` (its typed `total={7}` was wrong: the live quiz has 6). The highlight feature is retired as decided; the handoff has no keyword highlight.

**Reused, not forked (G4.1):** the `FlavorQuiz` state machine and every handler; `Navigation`; the chrome primitives (`Btn`, `Caps`, `Titled`, `Wrap`, `ArrowIcon`); `Photo` (fallbacks); `numberWord`; `trackEvent` / `logQuizFunnelEvent` / `getActiveCampaign` unchanged.

## Copy (G4.4) — for Dana to review in place

| Handoff | Now |
|---|---|
| "Seven questions about moments, reactions and familiar foods — never a flavor to name. About three minutes. On the other side: your family of taste and your place on the dial." | "{N} questions about moments, reactions and familiar foods, in your own words. About three minutes. On the other side: your family of taste and your place on the dial." ({N} = `numberWord(questions.length)`, "Six" today) |
| "No wrong answers. We listen for moments, not flavor words." | "Every answer counts. We listen for moments and reactions." |
| "Your first name" | "First name (yours or whoever you're profiling)" (the brief's household meaning) |
| (none) | Exit dialog: "Leave your profile here?" · "You can start again from the first question any time." · "Keep going" · "Leave" |
| "Begin my profile", "Already have a profile? Sign in", "Free · about three minutes" | unchanged |

Kept from the live page: "We couldn't load the quiz." + "Try again", "Finding your profile…", the tie lines, "Your match is waiting." and the sealed lines. "About three minutes" stays brand copy, as on The Axis; there is no duration data.

## Photos — `raw/` paths (rows appended to `MEDIA_MAP.json`, brief "7A")

| Scene | Handoff source (`source/flavor-b/media/`) | Upload to | Key |
|---|---|---|---|
| entry | `axis-bowl.jpg` | `raw/quiz/scene-entry.jpg` | `quizSceneAssets.entry` |
| question 1 | `shop-DSC_3942.jpg` | `raw/quiz/scene-q1.jpg` | `quiz_question.image_asset_key` |
| question 2 | `shop-DSC_3988.jpg` | `raw/quiz/scene-q2.jpg` | same column |
| question 3 | `shop-DSC_3902.jpg` | `raw/quiz/scene-q3.jpg` | same column |
| question 4 | `shop-IMG_0479.jpg` | `raw/quiz/scene-q4.jpg` | same column |
| question 5 | `shop-DSC_3886.jpg` | `raw/quiz/scene-q5.jpg` | same column |
| question 6 | `shop-IMG_0435.jpg` | `raw/quiz/scene-q6.jpg` | same column |
| branch ("one more") | `axis-cupping.jpg` | `raw/quiz/scene-branch.jpg` | same column (all branch questions) |
| result (7B) | `scan-chocolatenutty.jpg` | `raw/quiz/scene-result.jpg` | `quizSceneAssets.result` |

The media script's dry run reads 29 rows: the 20 earlier ones `same`, these 9 `missing`, so they are ready for the upload (OT-86). Some of these are the same photos as the Shop family cards: `shop-DSC_3886` (scene-q5) has the same md5 as `raw/shop/family-floral.jpg`.

## Evidence

**Tests:**
- **Frontend vitest: 95/95.** That includes the new `quiz/quiz.test.tsx` (11 cases):
  - the entry count from the payload, the name optional, the sign-in redirect;
  - N answers lettered A…, the real total, N segments;
  - Back keeps the selection; letter keys and arrows;
  - the funnel: names and payloads, the score body, the branch as "One more", `quiz_final` with the branch answer;
  - campaign fast-start; the returning user; the signed-in entry line; the gated sealed ending;
  - Exit with and without answers.
- **Backend `db/quizSceneImage.test.ts`, 3/3 on the test DB:**
  - the seeded keys;
  - the guard: a NULL fill is allowed once, while a key change, a key cleared, a text edit and a delete are all refused, and no new version opens;
  - both routes return the key.
- **Backend:** `services/quizContentScd2.test.ts` (the existing SCD2 suite) still passes, 15/15.
- **Full backend suite** (test DB): 1136 passed, 15 failed out of 1151.
  - **8 are the known baseline (G1.12):** 6 `quizScoring` tie-break cases, OT-73's `catalog_blueprint` case, and OT-85's `lintCustomer.test.ts` timeout (the lint itself exits 0).
  - **The other 7 came from contention with my own test runs:** `quizInterpretation` 5, `quizResultsView` 1, `roasteryPortalAccept` 1. I ran the SCD2 file by hand twice while the suite was running on the same test DB, and one of those runs hit `deadlock detected`. Rerun alone after the suite: those three files pass 47/47, and `quizContentScd2` + `quizSceneImage` pass 18/18.
- **CI lints, all exit 0:** `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage`.
- **Type-checks:** backend `tsc --noEmit` clean. Frontend `tsc --noEmit` adds no new error (the known set: `ArchetypeSection.tsx` `hops`, `useAdjacentArchetype.ts`, `Profile.tsx`). `vite build` is clean.

**Local acceptance (G5.2):** backend on `axisandbloom_test`, Vite :5179, headless Chromium, `?preview=true`, 390 and 1280.
- **Two keyboard-only runs**, one per width: Tab to "Begin my profile", Enter, then the B key on each of the 6 questions. The branch appeared ("One more") and A on it kept Fruity; the wrap ceremony ran and the result reads "Fruity.". No page errors and no horizontal scroll.

  | Width | `quiz_session` (test DB) | `quiz_funnel_event` rows (session key) |
  |---|---|---|
  | 390 | `65506afe-e9f2-4725-bc13-7a00f6b35e57`, completed 15:39:30 UTC | `bf213455…` quiz_start, `85e4f051…` quiz_complete Fruity, `42e10a99…` quiz_final Fruity (`6e1fee9e-7261-41bd-94ef-814d18a69c53`) |
  | 1280 | `15e4de5a-a27f-4652-892c-09eac6305271`, completed 15:39:57 UTC | `d687d565…` quiz_start, `c3a35ca6…` quiz_complete Fruity, `5769ec99…` quiz_final Fruity (`09187ed7-0fce-4a4c-9c7b-5bbe029fa758`) |

  Same calls, in the same order as before 7A: `POST /api/quiz/event quiz_start` → `POST /api/quiz/score {answerIds}` → `POST /api/quiz/event quiz_complete` → `GET /api/quiz/branch` → `POST /api/quiz/event quiz_final` → `POST /api/quiz/results` (200, the session id above).
- **Screenshots:** entry, question and branch at both widths. The 390 progress bar was tightened after the first pass: on phones the bar no longer wraps, and "One more" shows only in the counter.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, the scene photo's animation is `none` at both widths.

**Production (2026-11-06):**
- **Commit and deploy:** `baddcc6` pushed to `main`; Deploy run 42250474446 green (backend + frontend); Cloud Run revision `axis-bloom-backend-00829-hqt` (us-central1).
- **Startup log** (54 lines, two boots):
  - 0 ERROR.
  - The schema, with the guard exemption and the key seed, applied without error. `[data-catalog] report only: 155 tables, 78 views, 1415 columns` (one column more).
  - The one new finding was check #4 "CATALOG.md stale", expected; `CATALOG.md` was regenerated from prod (`npm run catalog:md -- --expect-db axisandbloom`, catalog-hash `64066c5b0054…`) and committed after.
  - All other findings are the same as on the earlier revisions: data-catalog #6, evidence-integrity #2 / #6, quiz-integrity #10, sommelier-integrity #3.
- **Live `GET /api/quiz/questions`:** six questions, `image_asset_key` `quiz/scene-q1` … `quiz/scene-q6`, 3 answers each. The prod seed ran.
- **Page smoke on prod: not done.** Both routes to a browser were closed:
  - Headless Chromium is redirected to www by `VITE_CANONICAL_HOST` and gets Cloudflare's "Just a moment…" challenge; it was not bypassed.
  - In Dana's Chrome, the Claude extension fails on `/find-my-flavor` with "Cannot access a chrome-extension:// URL of different extension" (scripts and screenshots, three tries), the same conflict as on Home.
  - So the 390/1280 screenshots, the keyboard-only run and the funnel ids come from the local acceptance above (the same build, against the test DB), and **Dana is asked to look at `/find-my-flavor?preview=true` in a private window** (entry, a question, the branch) and once signed in (the returning-user scene).
  - No anonymous run was made on prod, so no prod `quiz_session` or funnel rows were written by this brief.


