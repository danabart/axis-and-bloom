# Feature: Campaign fast-start — social-link arrivals skip the quiz entry screen

> Folder: `backend/src/features/hoboken_crawl/` · Decided: 2026-09-10 (Dana) · Model: Sonnet is fine (small frontend-only change)
> Status: ✅ executed 2026-09-10 (WHAT_WE_BUILT.md #176)
> Depends on: `CLAUDE_CODE_PROMPT_SOCIAL_CAMPAIGNS.md` executed (instagram/facebook slugs + `CampaignQueryReader`). If that brief has not run yet, run it first — this builds directly on it.

## What Dana wants (2026-09-10)

A visitor arriving on the quiz from a social campaign link (`/find-my-flavor?campaign=instagram...`) should land **directly on question 1**, not on the "Whose palate are we profiling today?" name screen. The name is collected **at the end**, on the post-quiz email card, which already has a required First name field. This mirrors the crawl's feel — but note the crawl works differently (`/crawl` collects the name itself and hands it over via sessionStorage `axisBloomCustomerName`); this task is for arrivals that have no landing page and therefore no name yet.

## CONTEXT — verified in code 2026-09-10, not assumed

- `FlavorQuiz.tsx`: `hasStarted` inits from `isPreview`; the `axisBloomCustomerName` sessionStorage effect (~line 912) sets name + `setHasStarted(true)` (the crawl/Home path); the recognized signed-in returning-user branches render "Welcome back" instead of the entry screen; `quiz_start` fires in `handleAnswerSelect` on the FIRST answer tap (`quizStartFiredRef`), reading `getActiveCampaign()` at that moment — so campaign attribution needs no ordering work.
- Empty-name states already exist: `{userName ? `${userName} —` : 'Your profile —'}` (~line 1786); `PostQuizEmailGate` takes `initialFirstName` as a `useState` initial value and still requires a typed first name. The one to verify, not assume: `WrapOverlay`'s `name={userName}` with an empty string.
- `lib/campaign.ts` exports `CAMPAIGNS`; the URL param arrives via react-router `useSearchParams` (already imported in FlavorQuiz).

## Decisions already made (Dana, 2026-09-10) — do not re-open

1. The skip applies ONLY when the quiz page's own URL carries `?campaign=<key of CAMPAIGNS>` — a direct campaign-link arrival. A visitor with a stored stamp who navigates to the quiz normally (typed URL, nav, next week) still gets today's entry screen. `/crawl`'s named handoff is untouched and keeps precedence (it arrives without a `campaign` param, via sessionStorage).
2. Recognized returning users are untouched: a signed-in user with an existing result who clicks the IG link still gets "Welcome back", not question 1. The skip affects only the path that would have rendered the anonymous entry screen.
3. Name at the end = the existing email card, unchanged: `initialFirstName` will simply be empty for these arrivals, the field stays required. No new name step anywhere.

## TASK (frontend only — `FlavorQuiz.tsx`, plus at most a tiny helper in `campaign.ts`)

1. In `FlavorQuiz`, detect a campaign fast-start: `searchParams.get('campaign')` is a key of `CAMPAIGNS`. Implement the skip with the same state transitions the `axisBloomCustomerName` effect uses (`setHasStarted(true)`, name left `''`), placed so its precedence relative to the sessionStorage name path and the returning-user branches matches Decision 1 and 2 (sessionStorage name wins if both are somehow present — it carries more information). Do not duplicate slug-validation logic — import from `campaign.ts`.
2. Verify every in-quiz surface renders acceptably with `userName === ''` for the whole run: question screens, `WrapOverlay` (`name=''`), the `{userName} —` profile line, the results/sealed flow, and the email card (empty, required, still submits with typed name → `newsletter_subscriber.first_name` set). Fix only what an empty name actually breaks (e.g. a dangling comma or "  —"), with the smallest change, and list each fix.
3. Nothing else changes: no backend, no schema, `quiz_start`/`quiz_complete`/`email_submitted` events and campaign attribution byte-identical in shape.

## CONSTRAINTS

Reuse the existing start mechanism; no new components; no query-param stripping. `vite build` + `npx tsc --noEmit` clean (zero new errors). Marked test data cleaned after.

## DONE = (one go, one report)

One commit pushed to `main` (`quiz: campaign links start on question 1, name collected at the end`), deploy green, startup log clean, acceptance below verified live, build-log entry in `WHAT_WE_BUILT.md`, this file's Status flipped.

## ACCEPTANCE (live production, fresh browser unless said otherwise)

1. `/find-my-flavor?campaign=instagram&utm_source=instagram&utm_medium=social&utm_campaign=launch-2026`: question 1 renders immediately (no name screen); landing beacon row + stamp present (regression from the social brief).
2. Complete that quiz with no name until the end: no broken text anywhere ("Your profile —" fallback shows where the name would); email card shows an EMPTY required First name field; submitting with a typed name lands `newsletter_subscriber` with that `first_name`, `campaign='instagram'`, vid set; match email fires.
3. `/find-my-flavor` with no param: today's entry screen, byte-identical behavior.
4. `/crawl` flow: type a name on Camila's page → quiz starts on question 1 WITH the name (sessionStorage path unchanged), card prefilled — regression of #174 acceptance 6–7.
5. Signed-in user with an existing result opens the IG link: "Welcome back", not question 1.
6. `?campaign=twitter` (unknown): entry screen as normal.
7. Funnel: the test run's `quiz_start`/`quiz_complete`/`email_submitted` rows all carry `campaign='instagram'` + the same vid.
8. Cleanup: delete the marked test rows (subscriber, funnel, landing) and the test Mailchimp member.
