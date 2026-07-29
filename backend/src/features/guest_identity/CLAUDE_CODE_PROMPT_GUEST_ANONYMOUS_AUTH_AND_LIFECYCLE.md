# Guest identity via Firebase Anonymous Auth + fold guests into the customer lifecycle

## Context

Since the quiz-first homepage change, most quiz-takers are guests — they never sign in before taking the quiz, and today they're invisible to two systems that already exist and work for real accounts:

1. **Quiz answer persistence.** `POST /api/quiz/results` (`backend/src/routes/quiz.ts`) writes the full `quiz_session` row (answers, scores, archetype) and mirrors to Firestore — but it's `requireAuth`, and `FlavorQuiz.tsx` only calls it `if (user)`. A guest's raw answers live in React state only and vanish on refresh. The only durable trace of a guest quiz completion today is `quiz_funnel_event` (session key + event name + archetype — no answers) and, if they submit the post-quiz email card, a `newsletter_subscriber` row (email + archetype, still no per-question answers).
2. **Customer lifecycle.** `user_lifecycle_state` / `user_lifecycle_event` / `classifyStage()` / `GET /api/users/homepage-state` (`backend/src/services/userLifecycle.ts`, `backend/src/routes/users.ts`) are entirely keyed on `user_profile.id`, and `user_profile.firebase_uid` is `NOT NULL` — there is no guest path into this system at all. `Home.tsx` never even calls `homepage-state` unless `user` is set.

Both systems already assume "a `firebase_uid` exists" and are otherwise fully built (lazy `user_profile` upsert-by-`firebase_uid` on first write, `classifyStage()` returns `NEW_NO_QUIZ` gracefully for a fresh profile, `refreshLifecycleState` no-ops safely if no profile row exists yet). The single missing piece is that guests have no `firebase_uid`.

## Goal

Give every visitor — including guests who never sign up — a real (invisible) Firebase identity via **Firebase Anonymous Auth**, so they flow through the *existing* quiz-persistence and lifecycle machinery with no duplicated logic. When a guest later creates a real account (email/password, Google, or Apple) with the browser session that took their quiz, **link** the anonymous credential to the new one so the *same* `firebase_uid` carries forward — their quiz history, `user_lifecycle_state`, and everything keyed off `user_profile` merges automatically, with zero backend changes required for that merge (it falls out of everything already being keyed by `firebase_uid`).

This does **not** require a schema migration. It does require one manual step in the Firebase console (see Prerequisite) that Claude Code cannot do.

## Prerequisite (manual, not code — flag this back to Dana if it hasn't been done)

In the Firebase console for this project: **Authentication → Sign-in method → Anonymous → Enable**. Nothing else in this prompt will work until that's on.

## Part 1 — Frontend: bootstrap anonymous identity

**`frontend/src/app/context/AuthContext.tsx`**

- Import `signInAnonymously` from `firebase/auth`.
- In the `onAuthStateChanged` callback: when `u` is `null` (no session at all — first visit, or fully signed out), call `signInAnonymously(auth)` instead of leaving `user` as `null`. This will itself re-trigger `onAuthStateChanged` with the new anonymous user, so let that second call through the normal path. Don't await it inline in a way that blocks `setLoading(false)` indefinitely — kick it off and let the resulting re-fire of `onAuthStateChanged` do the rest.
- The existing `/api/users/profile` fetch inside that callback (used only to derive `isAdmin`) currently runs for any truthy `u`. Gate it to skip anonymous users (`if (u && !u.isAnonymous) { ... }` else `setIsAdmin(false)`) — an anonymous user can never be admin, and skipping this avoids creating a `user_profile` row on every single page load from a visitor who never does anything else (that endpoint does a lazy `INSERT ... ON CONFLICT` upsert as a side effect of the isAdmin check).
- Add a convenience boolean to the context value, e.g. `isGuest: boolean` = `!!user && user.isAnonymous`, so call sites elsewhere don't have to keep reaching into `user.isAnonymous` directly. Keep `user` as the raw Firebase `User | null` — don't change its shape.

**Conversion — link instead of replacing the identity:**

- `signUp(email, password, firstName?, lastName?)`: if `auth.currentUser?.isAnonymous`, use `linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password))` instead of `createUserWithEmailAndPassword`. If that throws `auth/email-already-in-use` or `auth/credential-already-in-use`, let it propagate — `SignIn.tsx`'s existing `friendlyError()` already maps `email-already-in-use` to "An account with this email already exists. Switch to Sign In," which is the correct message here too (their email is already a real account elsewhere; this anonymous session's data won't merge into it via this path — that's an acceptable, rare edge case, not worth solving in this pass). If not currently anonymous (shouldn't normally happen given the bootstrap, but defend anyway), fall back to the existing `createUserWithEmailAndPassword` behavior.
- `signIn(email, password)`: **unchanged.** This is claiming a pre-existing, separate real account by password — there's no credential to "link" here, and Firebase doesn't support merging two already-real accounts. The current anonymous session's data (if any) is simply abandoned; this is expected and matches Firebase's own model. Not worth solving in this pass.
- `signInWithGoogle()` / `signInWithApple()`: if `auth.currentUser?.isAnonymous`, try `linkWithPopup(auth.currentUser, provider)` first. If that throws `auth/credential-already-in-use` (this Google/Apple identity already has a separate real Firebase account), fall back to a plain `signInWithPopup(auth, provider)` to sign into that existing account instead. If not anonymous, use the existing plain `signInWithPopup` path unchanged.
- Leave `syncUser()` / `POST /api/auth/sync` call sites exactly where they are today (only fired from `signUp`/`signInWithGoogle`/`signInWithApple`, i.e. only on genuine conversion or first real sign-in) — do **not** call it from the new anonymous bootstrap. `/api/auth/sync` grants a signup token bonus (idempotent per `firebase_uid` via `ON CONFLICT (uid) DO NOTHING` on `user_tokens`); we don't want that firing for anonymous sessions that never convert.

## Part 2 — Backend: let anonymous tokens through where guests should reach, block them where real accounts are required

Firebase issues normal, verifiable ID tokens for anonymous users — `admin.auth().verifyIdToken()` already works for them unchanged, so `requireAuth`/`optionalAuth` need no change to keep working. What's missing is a way to tell the two apart so purchase/account-management routes can require a real account.

**`backend/src/middleware/auth.ts`**

- Extend `AuthRequest` with `isAnonymous?: boolean`.
- In `requireAuth`, `optionalAuth`, and `requireAdmin`, after `verifyIdToken`, set `req.isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous'`.
- Add a new middleware, `blockAnonymousAuth(req: AuthRequest, res: Response, next: NextFunction)`, to be chained **after** `requireAuth` on routes that should stay real-account-only: if `req.isAnonymous`, respond `403` with something like `{ error: 'Create a free account to continue', code: 'anonymous_not_allowed' }`; otherwise `next()`.

**Apply `blockAnonymousAuth` (chained after `requireAuth`) to:**
- `routes/orders.ts` — `POST /`, `GET /`, `POST /:orderId/feedback` (no guest checkout — this site has no guest-checkout flow today and shouldn't gain one as a side effect of this change)
- `routes/household.ts` — all seven `requireAuth` routes (`/create`, `/mine`, `/invite`, `/leave`, `/members/:userId`, `/join/:token`, `/invitations/:invitationId`)
- `routes/companyGiftRedemption.ts` — `POST /:code/redeem`
- `routes/tokens.ts` — `GET /balance`, `POST /purchase`
- `routes/sommelier.ts` — all six `requireAuth` routes (Liam chat is token-metered; keep it real-account-only for now, independent of any future "Liam for guests" decision)

**Leave untouched (these are exactly the guest-friendly surfaces this feature unlocks):**
- `routes/quiz.ts` — `POST /results` (this is the point of the whole change)
- `routes/users.ts` — `GET /profile`, `GET /homepage-state`, `GET`/`PATCH /dial-position`, `GET /flavor-memory`, address routes (address routes are arguably purchase-adjacent — use judgment; addresses without an order aren't harmful, but flag this one back to Dana if unsure)
- `routes/newsletter.ts` — already `optionalAuth`, no change needed
- `routes/auth.ts` — `/sync` — harmless either way since it's never called for anonymous sessions per Part 1

No schema migration is needed. Every profile-creating query already does a lazy `INSERT ... ON CONFLICT (firebase_uid) DO UPDATE ... RETURNING id` (see `routes/quiz.ts`'s `POST /results`, `routes/users.ts`'s `GET /profile`, `routes/auth.ts`'s `/sync`), and none of them care whether the uid came from an anonymous or real sign-in.

## Part 3 — Frontend: let guests actually reach the persistence + lifecycle paths that already exist

Once every visitor has a `user` (anonymous or real), several `if (user)` / `!user` checks that used to mean "signed in vs. guest" now need to mean "real account vs. still-anonymous." Audit and update:

**`frontend/src/app/components/FlavorQuiz.tsx`**
- The `if (user) { saveQuizResult(...) }` guards (quiz completion, branch-answer completion, retake) — leave these as `if (user)`. They'll now fire for anonymous guests too, which is the point: this is what gets guest answers into `quiz_session`. No code change needed here beyond what Part 1/2 already unlock.
- `emailGateUnlocked = !!user || !!postQuizEmail` → change to `emailGateUnlocked = (!!user && !user.isAnonymous) || !!postQuizEmail`. Anonymous auth gives no email address — the post-quiz email card still needs to run for anonymous guests exactly as it does today.
- The guest-resync effect (`if (!resultsArchetypeData || user || !postQuizEmail) return;`, keyed on `recognizedGuestSyncedRef`) → change the `user` check to `(user && !user.isAnonymous)`, so it still fires for anonymous guests who've already given an email.
- The signed-in auto-subscribe effect (`if (!user || !resultsArchetypeData || !userProfile || !profileFetchDone) return;`, keyed on `signedInSubscribeFiredRef`) → change `!user` to `!user || user.isAnonymous`, so this "never show the card, auto-subscribe silently" path only fires for genuinely real accounts.

**`frontend/src/app/components/Home.tsx`**
- Today: `{!user ? (<name-capture form>) : renderSignedInCTA()}`. Decide (recommended: yes) whether anonymous guests should now go through `renderStageCTA` like real users do — that's the concrete form of "add guest state to the lifecycle" for the homepage. If so, change the branch to something like `{(!user || (user.isAnonymous && !homepageState)) ? (<name-capture form>) : renderSignedInCTA()}` — i.e. show the anonymous capture form only while there's no state yet (fresh guest, `NEW_NO_QUIZ`-equivalent), and switch to the lifecycle-driven CTA once `homepage-state` resolves for that guest (which will now succeed for anonymous users too, per Part 2). Also update `refreshHomepageState`'s `if (!user) { ... return; }` guard the same way. Verify the loading-state flash (`renderSignedInCTA` returns `null` while `homepageStateLoading` is true) doesn't leave anonymous first-time visitors staring at a blank section — fall back to the existing anonymous form during that brief window if `homepageState` is still null.

## Part 4 — Manual verification checklist (hand back to Dana/Camila, don't just assume green)

- Fresh incognito visit to the homepage silently creates a Firebase anonymous user (check Firebase console → Authentication → Users, or the network tab for a call to `identitytoolkit.googleapis.com/.../signupNewUser` or similar) — no visible UI change, no email/name prompt.
- Completing the quiz as that anonymous guest writes a real `quiz_session` row (`context_data` has real answers/scores) and a `user_lifecycle_state` row (`QUIZ_TAKEN_FRESH_NO_ORDER`).
- Reloading the homepage as that same still-anonymous guest (same browser) shows the lifecycle-driven CTA ("You're a ___ — shop your matches") instead of the blank name-capture form.
- That guest then creates a real account via "Create Profile" (same browser session) — confirm in Firebase console it's the **same** `uid` as before (not a new one), and that their `quiz_session`/`user_lifecycle_state` rows are still visible under `/profile` after signing in for real.
- That guest instead tries `POST /api/orders` (or hits checkout) while still anonymous — confirm a `403 anonymous_not_allowed`, not a successful order.
- A guest whose email, via Google/Apple sign-in, already belongs to a separate real Firebase account — confirm the fallback path signs them into that existing real account rather than erroring hard.

## Known limitations (by design, not bugs — don't try to solve these in this pass)

- No cross-device guest recognition. A guest who takes the quiz on their phone and later opens the site on a laptop gets a second, separate anonymous identity unless they've already given an email (the existing `localStorage`/`newsletter_subscriber` email-based recognition still covers that case independently).
- Signing into a pre-existing separate real account from an anonymous session does not merge that anonymous session's history — it's simply abandoned. This matches Firebase's own account-linking model.
- Every visitor now gets a free-tier Firebase Auth identity, including ones who bounce immediately. This is expected and by design (and cheap) — not a cost concern at this site's traffic scale, but worth knowing if you're ever staring at a Firebase Auth user count that looks much bigger than actual signups.
