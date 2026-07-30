# Follow-up: fix guest-identity gaps in Navigation/Profile + purge stale anonymous guests

## Context

`50cb4af` ("feat(guest-identity): Firebase Anonymous Auth + fold guests into
quiz/lifecycle machinery") gave every visitor an invisible anonymous Firebase
identity on first load, and updated `AuthContext.tsx`, `FlavorQuiz.tsx`, and
`Home.tsx` to tell a real signed-in account apart from an anonymous guest
(`isGuest` / `user.isAnonymous`).

It missed two files that still gate on plain `user` truthiness, which is now
true for *every* visitor, guest or not:

1. **`frontend/src/app/components/Navigation.tsx`** — the "Sign out" button
   (desktop `{user && (...)}` around line 132, mobile `{user && (...)}` around
   line 201) and the profile icon link (`to={user ? '/profile' : '/sign-in'}`
   around line 126) both show for anonymous guests. A guest who clicks "Sign
   out" calls `signOut(auth)` on their anonymous session; `AuthContext`'s
   `onAuthStateChanged` listener then sees `u === null` and immediately calls
   `signInAnonymously(auth)` again, minting a brand-new, unrelated anonymous
   uid. There is no "log back in" for an anonymous identity — the guest's
   prior quiz result and Firestore doc become permanently orphaned from that
   browser.

2. **`frontend/src/app/components/Profile.tsx`** and its route — `/profile`
   in `App.tsx` (~line 102) has no `RequireAuth` wrapper at all, and
   Profile.tsx's own guard (`if (!user) { navigate('/sign-in'); return; }`,
   ~line 122) also passes for anonymous guests. So a guest who reaches
   `/profile` (via the mis-guarded nav icon above, or a direct link) triggers
   `GET /api/users/profile`, which does a lazy `user_profile` upsert **and**
   writes a Firestore `users/{uid}` mirror doc for whatever uid is currently
   active. If that uid hasn't taken the quiz yet (e.g. it's a fresh uid
   created right after a sign-out), the doc comes out as
   `{ email: null, firstName: null, lastName: null, archetype: null,
   archetypeLabel: null, lastQuizDate: null, syncedAt: <timestamp> }` —
   which is what we found in the Firebase console: a "user" doc with nothing
   but a timestamp.

Separately: standard Firebase Authentication (we are **not** on the Identity
Platform tier) never auto-deletes anonymous users. Every anonymous identity
created — via the sign-out bug above, or just normal churn (incognito,
multi-device, cleared cookies) — sits in Firebase Auth, Postgres, and
Firestore forever unless something purges it. This prompt adds that purge as
a scheduled cron job, following the existing pattern in
`backend/src/routes/cron.ts`.

Retention policy (confirmed with Dana):
- An anonymous guest who **never completed the quiz** → purge after **7
  days** of inactivity since creation.
- An anonymous guest who **did complete the quiz** (has at least one
  `quiz_session` row) but never converted to a real account and never
  ordered → purge after **90 days** since their most recent quiz session.
- A guest who has since linked to a real account (signed up, Google, Apple)
  is **not** anonymous anymore and must never be touched by this job, even
  if their uid is old. `linkWithCredential`/`linkWithPopup` keep the same
  uid, so "is this uid still anonymous" must be checked live against
  Firebase Admin Auth at cleanup time — it cannot be inferred from Postgres
  alone.

## Part A — stop the bleeding (Navigation + Profile access)

### 1. `frontend/src/app/context/AuthContext.tsx`
No change needed — `isGuest` already exists on the context (`!!user &&
user.isAnonymous`). Just consume it below.

### 2. `frontend/src/app/components/Navigation.tsx`
- Destructure `isGuest` from `useAuth()` alongside `user`/`isAdmin`.
- Desktop and mobile "Sign out" buttons: change `{user && (...)}` to
  `{user && !isGuest && (...)}` in both places (~line 132 and ~line 201).
- Profile icon link: change `to={user ? '/profile' : '/sign-in'}` to
  `to={user && !isGuest ? '/profile' : '/sign-in'}`.

### 3. `frontend/src/app/components/RequireAuth.tsx`
Treat an anonymous session as "not authenticated" for any route wrapped in
`RequireAuth` — this component already exists specifically to gate
account/purchase-style pages, matching the intent of the backend's
`blockAnonymousAuth` middleware. Pull `isGuest` from `useAuth()` alongside
`user`/`loading`, and change the redirect condition from `if (!user)` to
`if (!user || isGuest)`.

### 4. `frontend/src/app/App.tsx`
Wrap the `/profile` route in `RequireAuth`, matching the existing pattern
used for `/sommelier` (~line 108-113):
```tsx
<Route
  path="/profile"
  element={
    <RequireAuth>
      <Profile />
    </RequireAuth>
  }
/>
```
This sends anonymous guests to `/sign-in` instead of letting them hit
`GET /api/users/profile` and create an empty Firestore doc.

### 5. `backend/src/routes/users.ts` (defense in depth)
Apply the existing `blockAnonymousAuth` middleware (added in `50cb4af`, used
on orders/household/companyGiftRedemption/tokens/sommelier) to
`GET /profile` and `PATCH /profile` too. This is a second line of defense in
case any other UI path ever reaches these routes while anonymous — the
client-side fix in Part A is what actually matters for the UX, this just
makes the API itself refuse to mirror-write Firestore docs for guests.

## Part B — scheduled purge of stale anonymous guests

### 6. `backend/src/services/staleGuestCleanup.ts` (new file)

Export `async function purgeStaleAnonymousGuests(): Promise<{ checked: number; purged: number; skipped: number }>`.

Logic:
1. Query Postgres for two candidate sets, each capped at a reasonable batch
   size (e.g. 500 per run — this is a daily job, no need to process
   everything in one shot):
   - **No-quiz candidates**: `user_profile` rows with `created_at < now() -
     interval '7 days'` that have **zero** `quiz_session` rows and **zero**
     `"order"` rows.
   - **Quiz-taken-but-stale candidates**: `user_profile` rows whose most
     recent `quiz_session.completed_at < now() - interval '90 days'`, with
     **zero** `"order"` rows.
   Exclude any `user_profile` row that has a row in `user_email` with
   `is_verified = true` — that's a reasonable Postgres-side proxy for "has
   ever completed a real sign-up," saving an Admin SDK round-trip for the
   obvious cases. (The Firebase Admin check in step 2 is still the source of
   truth — this is just a cheap pre-filter.)
2. For each candidate `firebase_uid`, call `admin.auth().getUser(uid)` (wrap
   in try/catch — a `auth/user-not-found` means it's already gone from
   Firebase Auth, treat as "safe to clean up Postgres/Firestore remnants
   too"). Only proceed if the returned user record has `providerData.length
   === 0` (still purely anonymous, never linked). If it has any linked
   provider, skip it — do not touch it — even if it matched the SQL
   candidate query.
3. For each confirmed-still-anonymous uid:
   - Delete the Firebase Auth user: `admin.auth().deleteUser(uid)` (skip
     `auth/user-not-found` errors).
   - Delete the Firestore doc and its known subcollections: `users/{uid}`,
     `users/{uid}/quiz_sessions/*`, `users/{uid}/feedback_events/*`,
     `users/{uid}/metadata/*`. Use a small recursive-delete helper (Firestore
     Admin SDK has `firestoreDb.recursiveDelete(docRef)` — use that instead
     of hand-rolling subcollection deletes).
   - Delete the `user_profile` row in Postgres:
     `DELETE FROM user_profile WHERE firebase_uid = $1`. Wrap this single
     query in its own try/catch — if it throws a foreign-key violation
     (meaning some table we didn't anticipate still references this user),
     log it, count it as skipped, and move on rather than aborting the whole
     batch. (`quiz_session`, `user_email`, `user_phone`, `address`,
     `user_tokens`, `token_events`, and most other user-scoped tables cascade
     on delete; a few like `"order"` don't, which is intentional — an
     anonymous guest should never have an order since `blockAnonymousAuth`
     already blocks anonymous checkout, so this is a belt-and-suspenders
     guard, not an expected path.)
4. Return counts. Log a one-line summary (`checked`, `purged`, `skipped`) —
   this job runs unattended, so the log is the only visibility into it.

### 7. `backend/src/routes/cron.ts`

Add a new route following the exact existing pattern (see
`GET /liam-sms-send` and `GET /expire-company-gift-codes` in this file):

```ts
// ── GET /api/cron/purge-stale-anonymous-guests ────────────────────────────
// Daily sweep. No auto-cleanup exists on our Firebase Auth tier (that's an
// Identity Platform feature we don't have), so anonymous identities from
// guest browsing, incognito sessions, and multi-device visits would
// otherwise accumulate in Auth/Postgres/Firestore forever. See
// backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_IDENTITY_FOLLOWUP_NAV_AND_CLEANUP.md
router.get('/purge-stale-anonymous-guests', requireCronSecret, async (_req, res) => {
  try {
    const result = await purgeStaleAnonymousGuests();
    res.json(result);
  } catch (err) {
    console.error('[cron/purge-stale-anonymous-guests]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});
```

## Manual prerequisite (cannot be done from code)

A **Cloud Scheduler** job must be created pointing at
`GET /api/cron/purge-stale-anonymous-guests` with the `x-cron-secret` header
set to the existing `CRON_SECRET` value, same as the other cron jobs in this
file. Suggest running it once daily, off-peak. This is infrastructure
provisioning outside this repo — flag it back to Dana/Camila the same way the
"enable Anonymous sign-in in Firebase Console" step was flagged in the
original guest-identity prompt.

## Out of scope / explicitly not doing

- Not changing anonymous-auth mechanics themselves (`signInAnonymously`,
  `linkWithCredential`, etc.) — those are correct as built.
- Not adding a "log back into your guest session" feature — anonymous auth
  has no such concept; the fix is to stop offering guests an action
  (Sign out) that destroys their only path back to their data.
- Not backfilling/purging existing orphaned docs from before this fix ships
  — the new cron job will catch them on its first run once the 7-day/90-day
  windows apply, no separate one-off migration needed.

## Verification checklist (manual, after deploy)

- [ ] As a fresh guest (clear site data / incognito), confirm the nav bar
      shows no "Sign out" button and the profile icon links to `/sign-in`.
- [ ] As a guest, manually navigate to `/profile` directly — confirm it
      redirects to `/sign-in` instead of loading.
- [ ] Complete the quiz as a guest, confirm the `users/{uid}` Firestore doc
      has `archetype`/`archetypeLabel`/`lastQuizDate` populated (not just
      `syncedAt`).
- [ ] Sign up for a real account from a guest session (email/password or
      Google), confirm the "Sign out" button now appears and works normally,
      and that the same `firebase_uid` carries over (no duplicate
      user_profile row).
- [ ] Hit `GET /api/cron/purge-stale-anonymous-guests` manually with the
      correct `x-cron-secret` header against a test/staging guest that's
      artificially aged past 7 days, confirm it's removed from Firebase Auth,
      Postgres, and Firestore, and that a *linked* (converted) test account
      aged the same way is left untouched.
