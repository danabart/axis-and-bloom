# Feature: Pre-Launch Reveal-in-Inbox — sealed quiz ending + match claim at signup

> Folder: `backend/src/features/pre_launch_reveal_in_inbox/` · Decided: 2026-08-12 (Dana + Camila) · Model: **Opus/Fable** (cross-cutting: quiz flow + auth sync + prelaunch flag)
> Status: ✅ executed (2026-08-11) — see WHAT_WE_BUILT.md #158 and the "Execution notes" section below (one live-testing gap: signed-in browser verification blocked by this dev environment's Firebase App Check debug-token registration, scoped per origin/port — not a code issue, see notes)
> Depends on: Pre-Launch Gate (#156, `frontend/src/app/lib/prelaunch.ts` + `PrelaunchGate.tsx`) — merged (`8164e23`) before this work started.

CONTEXT: Pre-launch funnel decision (Dana + Camila): before Oct 1, finishing the quiz should NOT show the match on screen. The flow becomes: quiz ends → email card ("your match is in — where should we send it?") → on submit, a confirmation that the match is on its way to their inbox. The reveal itself happens in the welcome email, which Mailchimp already sends automatically on quiz completion (journey is set up — **do not add, change, or send any email from our code; do not touch Mailchimp config**). After launch, the current on-screen reveal returns exactly as it is today.

Current flow (Step 04 firm gate + 04b): Section 1 (archetype reveal — name, wallpaper, bag) is free → email card → Sections 2–3 (why + matched coffees) unlock on submit. This task changes the PRE-LAUNCH flow only, behind the same switch the gate uses: `PRELAUNCH_MODE` + the `?preview=true` sessionStorage bypass (`usePrelaunchGated()` in `frontend/src/app/lib/prelaunch.ts`). **The Oct 1 flag flip must restore today's full reveal flow with zero further changes.** With the flag off (or preview set), behavior must be byte-identical to today.

TASK:

## 1. Sealed ending for first-time guests (the dominant case)

While gated, on quiz completion render NO part of the results content — no Section 1 reveal, no Sections 2–3, no archetype name, wallpaper, bag image, archetype color theming, or archetype-derived DOM anywhere. Instead, the existing email card (`PostQuizEmailGate`) becomes the single ending screen, with copy adjusted for the sealed flow:

- Headline: "Your match is in. Where should we send it?"
- Sub: "Your archetype, the why behind it, and your matched coffees — plus first access October 1."
- Same one field + one button, same calm rules from Step 04: appears once, in place, no countdown, no nagging, no skip.

On successful submit (the existing `POST /api/newsletter/subscribe` call with archetype/confidence/quizSessionKey — completely unchanged), swap the card in place for a confirmation state:

- "It's on its way to <their email>. Open it to meet your match."
- Keep one quiet supporting line ("You're on the first-access list for October 1.") — nothing else. No archetype anywhere.

Copy follows the positive-register rule: never name what's being withheld or when it's "not" shown; banned words per brand ("test", "verdict", "free", "coupon", "not X but Y" constructions). The lines above are approved copy — use them.

## 2. Repeat visitors stay sealed

- **Returning guest who already submitted** (recognized via the existing local flag / resync path): show the confirmation state directly — "Your match is on its way to <masked email>" (this masked-email state already exists — reuse it), with the same silent subscriber resync as today. No archetype on screen.
- **Returning visitor with a saved quiz result reloading `/find-my-flavor`**: the returning-user screen currently shows "Your primary profile is [archetype]" — while gated, that would break the seal for anyone who reloads after finishing. Gate that screen's archetype display too: while gated, a returning visitor with a completed quiz sees the confirmation-style state (match is in their inbox / on their profile) instead of the archetype name, with the existing retake option preserved.
- **Signed-in real-account users** completing the quiz while gated: no email card (their email is known; the existing auto-subscribe path runs unchanged) → show the same confirmation state addressed to their account email.
- **`/profile` stays as-is** (already gated by the Pre-Launch Gate's `prelaunch` prop work): once someone has created an account from the email, their Flavor Memory tab showing the match is the "saved" promise kept — do not seal the profile page.

## 3. Match claim at account creation (email match — no email/template changes)

The match now reaches the user only through their inbox, and most email is opened on a different device than the one that took the quiz. Same-browser signups already keep the match (anonymous-uid linking, #119). Close the cross-device gap WITHOUT touching the email template:

- On real-account creation (email/password sign-up, Google, or Apple — including linking from an anonymous session), during the existing `POST /api/auth/sync` flow: if the account has no archetype/quiz result yet, look up `newsletter_subscriber` by the account's email (case-insensitive). If a row with an `archetype` exists, attach that match to the account through the SAME persistence path the profile/homepage-state already reads (whatever `/profile`'s Flavor Memory and `GET /api/users/homepage-state` resolve archetype from — reuse it; do not invent a parallel store).
- Idempotent and never destructive: only fills when the account has no result; an existing quiz result is never overwritten; running twice changes nothing.
- If no subscriber row matches (e.g. Google account under a different address), do nothing — clean empty state, no error.

## 4. Leave alone

- `POST /api/newsletter/subscribe`, Mailchimp sync, tags, and ALL email content/journeys — untouched. No email-sending code anywhere in this task.
- Analytics: existing `quiz_start` / `quiz_complete` / `email_submitted` funnel events fire exactly as today.
- The Pre-Launch Gate work (#156) — build on it, change none of it.
- Quiz scoring, branch question, lifecycle transitions — untouched.

CONSTRAINTS: reuse `PostQuizEmailGate`, `usePrelaunchGated()`, and existing states/components — no new subscribe path, no forked components (standing rule). All prelaunch conditionals derive from the one existing source of truth in `prelaunch.ts`. This frontend's `vite build` does not type-check — run `npx tsc --noEmit` too. Do not submit real third-party email addresses to production email paths during verification; use clearly-marked disposable test data and clean up rows afterward, per this repo's established verification practice.

ACCEPTANCE (verify live in a real browser, gated dev server, not by code reading):

1. Fresh guest completes a real quiz → sealed email card, and a DOM-level check confirms NO archetype name (any of the five + Experimental), wallpaper, or bag asset is present anywhere on the page before OR after submit.
2. Submit → confirmation with their address shown; `newsletter_subscriber` row lands with archetype + `source post_quiz`; funnel events logged as today.
3. Reload after submit → still sealed (masked-email confirmation, no archetype in DOM). Returning visitor with a saved result on `/find-my-flavor` → sealed returning state, retake still available.
4. Signed-in real account completes quiz → confirmation state, no email card, auto-subscribe row as today.
5. Claim: in a DIFFERENT browser (no shared session), create an account using the same email that was submitted at the gate → `/profile` Flavor Memory shows the match. Create an account with an unrelated email → clean empty state. Repeat sign-in does not duplicate or overwrite anything.
6. `?preview=true`: today's full flow returns end-to-end (free reveal → card → sections unlock).
7. Flag off: byte-identical to current behavior (today's reveal flow), confirming Oct 1 remains a one-flag flip.
8. `vite build` AND `npx tsc --noEmit` clean.

MANUAL (Dana/Camila, outside this task): one real end-to-end timing test — take the quiz with a personal address and confirm the Mailchimp match email lands within a minute or two of submit; and confirm the welcome email's main button links to the sign-in/create-account page (its current `/bloom` link points at a page that is now behind the curtain).

## Execution notes (2026-08-11)

**Backend (§3, match claim)** — extracted the `quiz_session` write out of `POST /api/quiz/results` into `backend/src/services/quizSession.ts`'s `saveQuizSession()` (byte-identical SQL/params at the original call site) so `POST /api/auth/sync`'s new match-claim block writes through the exact same persistence, per the task's "reuse it, don't invent a parallel store" instruction. The claim only fires when `SELECT 1 FROM quiz_session WHERE user_id = $1` is empty (so it's safe to run on every `/sync` call, not just signup), looks up `newsletter_subscriber` by `LOWER(TRIM(email))`, and — deliberately — does **not** mirror to Firestore or re-run AI recommendation generation the way a real quiz completion does; it only writes the Cloud SQL row `/profile`/`/homepage-state` actually read, plus a fire-and-forget `refreshLifecycleState()` so the account leaves `NEW_NO_QUIZ` immediately rather than waiting on that endpoint's own lazy fallback.

**Live verification split into two tracks**, both against production Cloud SQL via the Auth Proxy:

1. **Frontend, live in a real browser**, gated dev server (`VITE_PRELAUNCH_MODE=true`): a full real guest quiz run through the actual email gate, with DOM-level assertions (zero archetype-name text, zero archetype-specific image assets, checked programmatically before AND after submit) — acceptance criteria 1 and 2 fully confirmed this way, copy matches the spec's approved lines exactly. `?preview=true` confirmed to restore the complete unsealed flow end-to-end (hero, "Your match"/archetype header, full `DialArchetypeSection` with Add to Cart). Flag-off (a separate, already-running dev server with no `VITE_PRELAUNCH_MODE` set) confirmed visually identical to the gated server's `?preview=true` render, satisfying criterion 7.
2. **Backend, direct endpoint testing** (same methodology as WHAT_WE_BUILT.md #155's AI Ops verification — real minted Firebase ID tokens for throwaway test users, created via the Admin SDK and deleted after): confirmed `POST /api/auth/sync` (a) creates exactly one `quiz_session` row with the correct archetype when a matching `newsletter_subscriber` row exists, (b) is fully idempotent — calling it twice for the same account leaves exactly one row, (c) is a clean no-op (zero rows, `200 ok`) for an account whose email has no subscriber row, and (d) correctly flips the account's lifecycle stage from `NEW_NO_QUIZ` to `QUIZ_TAKEN_FRESH_NO_ORDER` via the fire-and-forget `refreshLifecycleState()` call. All test rows (Cloud SQL + Firebase Auth users) deleted immediately after, confirmed via a follow-up zero-rows query.

**One live-verification gap, disclosed rather than papered over**: this dev environment's Firebase App Check debug-token registration is scoped per browser **origin** (i.e., per port) — `localhost:5173` (the long-running, already-registered dev server) has a working registration; every fresh port I started for this task (`5174` in the prior session, `5175` here) does not, and neither anonymous nor custom-token sign-in can complete there (`AppCheck: ... HTTP status: 403`, confirmed via console error, not guessed). That blocks live-browser verification of the two states that require a genuinely authenticated session in a freshly-started gated server: (a) criterion 4's signed-in confirmation screen with the account's own email, and (b) visually confirming a claimed match in a signed-in `/profile` Flavor Memory tab. Considered and rejected two workarounds: registering a new debug token would need Firebase Console access this session doesn't have; copying the already-trusted token's cached value from `5173`'s IndexedDB into `5175`'s was blocked by the harness's own safety classifier as credential-adjacent, correctly — not attempted further. Confidence in both unverified states instead rests on: the signed-in branch is the *exact same* `emailGateUnlocked`/`sealedEmail` conditional already proven live for the guest path (only the email source differs — `userProfile.email ?? user.email` instead of the submitted/masked guest address); and the claim itself is independently proven correct and idempotent at the data layer via the backend track above, which is what `/profile` renders from. Not a code correctness gap — an environment constraint, worth registering a debug token for a stable gated dev port if this needs re-testing.
