# Brief: Website 7A — Find my flavor: shell, entry and question scenes (option B)

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** brief 1 (chrome `tone="paper"` and the Menu overlay).

Read first: `README.md` (merge rule, D6, D11), `HANDOFF_SURVEY_2026-11-04.md` §5, `backend/src/features/quiz_interpretation_v2/` (questions and answers are SCD2 data; `project_quiz_content_editing` rules), `backend/src/features/find_my_flavor_page/`, `backend/src/features/hoboken_crawl/` (campaign fast-start), `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/flavor-b/build.py` + `index.html` (option B). `standalone/axis-and-bloom-find-my-flavor.html` (option A) is not used.

## Goal

The quiz's entry and question screens look like option B (photo per scene, dark wash, text rows A–D, the progress bar that replaces the header, "Exit ×"), on the real data pipeline (`GET /api/quiz/questions` → `POST /api/quiz/score` → branch), with every current behaviour kept and the states the design lacks drawn in its style. The result screen is brief 7B; until 7B runs, the current result screens render unchanged after the new question scenes.

**Decisions already made (do not re-open):**
- Question and answer text, count, order, scoring, branch: data. The handoff's seven questions are layout only. The counter and progress segments use the real count.
- Question images become data: a nullable `image_asset_key` on `quiz_question` (registry key), written only by the seed/admin door the quiz content has; `QUESTION_IMAGES` leaves the code. The handoff has no keyword highlight, so the highlight feature and `Q_HIGHLIGHTS` are retired (recorded in the closing report).
- Name on entry: optional (handoff), prefilled from the home page capture; the button is enabled without a name; "Whose palate are we profiling today?" keeps the household meaning: label reads "First name (yours or whoever you're profiling)".
- Add in B's style: back button ("← Back" `Caps`, top-left of the scene, hidden on question 1), keyboard (A–D keys and arrow/enter on rows, `role="radiogroup"`), the branch question as scene N+1 with the same layout and the progress bar showing "one more" without renumbering, the tie screen, the returning-user screen (Welcome back + saved archetype + retake, as today, on the entry photo), the prelaunch sealed ending (today's logic), loading ("Finding your profile…") and error-with-retry.
- Header: `Navigation tone="paper"` floats over the entry photo; during questions the progress bar replaces it (as drawn); no footer on this route (as today).
- Quiz chrome kept: "Save progress" for guests moves into the progress bar beside "Exit ×".

**Guardrails.** G4.1 reuse: `FlavorQuiz.tsx` logic (do not rewrite the state machine; replace the render of the entry/question/branch/tie/returning/loading screens), `Navigation`, chrome primitives, `trackEvent`/funnel, `getActiveCampaign` · G4.2 nothing typed in: no question/answer text, no count · G2.1/G2.17 for the two `quiz_question` columns (SCD2: a new column on a versioned table is additive and does not open a new version; say so in the comment) · G2.5 the `quiz_question` writer stays `seed`; the admin content door, if one exists, is extended, not forked · G4.4 rewrite the two negative lines · G4.6 · G1.6. Mode: test. STOP: none (schema additive; seeds insert only the image keys for current questions).

## Task 0 — verify first (findings into `CLOSING_REPORT_7A.md`)

1. Read `FlavorQuiz.tsx` fully and write the behaviour inventory with line numbers: data fetch and score flow · session key and funnel events (`QuizStart`, `quiz_start`, `QuizComplete`, `quiz_complete`, `quiz_final`, `email_submitted`) · campaign fast-start (`?campaign=`) · `?retake=1`, `?result=` preview · name prefill (`sessionStorage axisBloomCustomerName`) and the signed-in entry line · returning-user screen · prelaunch sealed path · wrap ceremony (keep; it runs between the last answer and the result; restyle its colours to the tokens only) · back button · "Save progress" / "Exit ×" · `PostQuizEmailGate`, `ShareMatchRow`, end action row (7B keeps these) · `FloatingCart` absence on this route.
2. Read `build.py`: entry scene, question scene, progress bar markup and CSS, the auto-advance (420 ms), the photo-per-scene assignment.
3. Read the quiz content tables in `CATALOG.md` (`quiz`, `quiz_question`, `quiz_answer`) and the seed that writes them; confirm how a new column is added without creating a new version.
4. Confirm the registry can hold seven question photos + the entry photo (`quizAssets.*`).

## Task 0.5 — Dana's manual steps

None by hand. This brief appends the quiz photo rows (entry, result, one per question) to `MEDIA_MAP.json` in this folder; the upload runs through `CLAUDE_CODE_PROMPT_WEBSITE_MEDIA_UPLOAD.md` afterwards. Until then a question with no image renders the entry photo's fallback.

## Part A — schema

`quiz_question.image_asset_key text NULL` with its comment; seed the keys for the current main-quiz questions (`q_number` → key) `WHERE image_asset_key IS NULL`; `GET /api/quiz/questions` returns it. `comments.sql` → `catalog:md`.

## Part B — frontend

- Entry scene as drawn (photo, label, h1, lead with the question count from the questions payload length, not typed (D15), name field, "Begin my profile", "Already have a profile? Sign in" → `/sign-in?mode=signin&redirect=/find-my-flavor`, bottom bar). Signed-in variant: the current "Signed in as … · profiling yourself or someone in your household" line replaces the sign-in link. Returning-user variant on the same scene.
- Question scene as drawn, N answers as rows (the data decides N; rows wrap for 5–6), letters A… generated, auto-advance 420 ms, selection remembered when going back, keyboard and ARIA, `aria-live` counter "{n} / {total}". Branch and tie scenes share the component.
- Progress bar replaces the header during questions: name ("{Name}'s profile" / "Your profile"), `total` segments, "Save progress" (guests), "Exit ×" → entry scene (confirm dialog if answers exist, in the design's `Btn` style; no browser `confirm()`).
- Loading and error scenes on the entry photo. Prelaunch sealed ending restyled to the tokens (logic untouched).
- Copy: "No wrong answers. We listen for moments, not flavor words." → positive form, and "never a flavor to name" likewise; list in the closing report.
- Retire `QUESTION_IMAGES`, `Q_HIGHLIGHTS` and the highlight rendering.

## Part C — tests

vitest: questions render from a mocked payload with N answers and the real total; back restores the selection; keyboard A–D selects; branch scene appears after the main quiz; funnel events fire with the same names and payloads as before (assert against the current test expectations); campaign fast-start skips entry; returning user sees the saved archetype; gated mode reaches the sealed ending.

## Acceptance

Live `?preview=true` and a real anonymous run: 390/1280 screenshots of entry, a question, the branch question, the returning-user entry; a completed run writes `quiz_session` and the funnel rows as before (ids in the report); keyboard-only run; reduced motion.

## Docs and closing

`WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md` line, `CATALOG.md`, `REGRESSION.md` (funnel event names, campaign fast-start, retake, returning user, sealed ending, back/keyboard), `OPEN_TASKS.md`, `CLOSING_REPORT_7A.md` with the `raw/` paths and the copy rewrites.

## Do not

- Do not type any question or answer; do not change scoring, branch logic or the funnel.
- Do not touch the result screens (7B).
- Do not use `window.confirm`/`alert`.
