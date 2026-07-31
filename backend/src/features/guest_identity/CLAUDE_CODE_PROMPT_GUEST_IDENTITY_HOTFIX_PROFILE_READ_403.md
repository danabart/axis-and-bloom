# Hotfix: GET /api/users/profile wrongly blocks anonymous guests (regression from #120)

## What broke

`#120`'s "defense in depth" step added `blockAnonymousAuth` to both
`GET /profile` and `PATCH /profile` in `backend/src/routes/users.ts`. That
was wrong for the `GET` route: `getUserProfile()` (`frontend/src/app/lib/api.ts`)
is called by three guest-facing components, not just the now-`RequireAuth`-gated
`Profile.tsx`:

- `frontend/src/app/components/FlavorQuiz.tsx` (~line 613, and again in
  `refreshUserProfile()` ~line 638) — this is exactly how the quiz page
  recognizes a returning guest and shows their existing archetype instead of
  restarting the quiz.
- `frontend/src/app/components/BloomPage.tsx` (~line 79)
- `frontend/src/app/context/CartContext.tsx` (~line 44)

All three now get a silent 403 (each call site swallows the error with
`.catch(() => {})`, so nothing throws — the page just behaves as if the
guest has no profile at all). Confirmed live: a fresh anonymous session
hitting `/find-my-flavor` gets `GET /api/users/profile → 403`. This is what
Dana is seeing as "the quiz doesn't remember me" — same tab, new tab, or
incognito, it doesn't matter, because the block applies to every anonymous
caller regardless of browser context.

**Quiz data itself is not affected.** `POST /api/quiz/results` was never
touched by `blockAnonymousAuth` — quiz answers are still saving correctly to
Postgres and Firestore for guests. This is purely a broken read-back/
recognition path, not data loss.

## Fix

In `backend/src/routes/users.ts`:

- `GET /profile` (~line 41): remove `blockAnonymousAuth` from the middleware
  chain. Restore it to `router.get('/profile', requireAuth, async (req: AuthRequest, res) => {`.
  This route's own logic already handles a guest with no email/quiz history
  safely (lazy-upserts `user_profile`, returns nulls for anything that
  doesn't exist yet) — that null-safety is exactly what guest callers rely
  on, and it predates #120.
- `PATCH /profile` (~line 201): leave `blockAnonymousAuth` in place. No
  guest-facing code path calls `PATCH /profile` — its only caller is
  `Profile.tsx`, which is now behind `RequireAuth` (#120, Part A), so an
  anonymous session can never reach it through the UI. Keeping the block
  here is correct and doesn't need to change.

## Why this is safe

Removing `blockAnonymousAuth` from `GET /profile` does not reopen the bug
#120 fixed. The original problem was `/profile` being *reachable and
navigable* by guests (via the mis-guarded nav icon, with no route guard),
which caused a lazy-upsert side effect from a page visit. That's fixed by
`RequireAuth` now wrapping the `/profile` page and `Navigation.tsx` no longer
linking guests there — both stay in place. The API-level block was always
the "belt and suspenders" half of that fix, not the actual mechanism, and it
turned out to be over-broad: it blocked a route that legitimate guest
features (quiz recognition, Bloom page, cart) were already depending on
before #120 ever shipped.

## Verification checklist (manual, after deploy)

- [ ] Fresh anonymous guest (clear site data / incognito): `GET /api/users/profile`
      returns 200, not 403.
- [ ] As that guest, complete the quiz, then reload `/find-my-flavor` (or
      revisit via the homepage) — confirm it now shows the returning-guest
      state (existing archetype) instead of restarting the quiz.
- [ ] Confirm `Profile.tsx` is still unreachable by an anonymous guest
      (redirects to `/sign-in`) — this part of #120 must still hold.
- [ ] Confirm `PATCH /api/users/profile` still returns 403 for an anonymous
      caller (e.g. via a direct API call) — this part of #120 must still
      hold too.
