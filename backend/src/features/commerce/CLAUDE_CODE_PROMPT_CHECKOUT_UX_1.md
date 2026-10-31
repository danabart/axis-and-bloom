# Claude Code brief — Checkout UX 1: the pages around checkout

Workstream: commerce (`backend/src/features/commerce/README.md`) · Written 2026-10-31 by the CTO session from `HANDOFF_CHECKOUT_UX_BUGS_2026-10-31.md` · Frontend only, plus one line in the deploy workflow · Dana runs it; merge to main = production deploy.

**Goal.** Four bugs from the first prod purchase, all in the site flow around Stripe, none in Stripe itself: (a) the header cart icon does nothing, (b) so there is no way to reach `/checkout` except from the Bloom page, (c) after paying, Dana landed on a signed-out quiz entry instead of `/checkout/return`, (d) "Find my flavor" while signed in reads like being signed out.

**Do not touch:** `checkoutService.ts`, `stripeWebhook.ts`, `orderFinalizer.ts`, `commerce_parameter`, anything under `services/fulfillment/`, `CheckoutPage.tsx`, `CheckoutReturnPage.tsx`, `CartContext.tsx`. That code passed acceptance and is live in test mode. No schema change, no DB write, no new table, no new route.

**House rules that bind this brief** (`CLAUDE.md`): nothing hard-coded (the canonical host in Part C comes from the deploy config, never from a string in code); no scope beyond the four bugs; no PR, Dana merges to main.

**Development guardrails (Dana, 2026-10-31; they bind every brief, this one included):**

- **Nothing new in the database.** This brief creates no table, view, column, reader or writer. If any part turns out to need one, stop and write it in the closing report instead of building it; it gets its own decision.
- **Before any reader or writer exists, check what already exists.** `CATALOG.md` (generated, never hand-edited) for the object, `backend/src/db/comments.sql` `Writer:` fields and `lineage.json` for who writes it, and the existing read module (`*Reads.ts`) for who reads it. A second reader or writer of the same table is how data drifts; reuse the existing one.
- **One writer and one reader per table.** Writes go through the module named in the table's `Writer:` field, reads through its read module. `npm run lint:lineage` enforces the writer side in CI.
- **Primary keys are surrogate `id` columns**, SERIAL or UUID. Natural and composite keys are `UNIQUE` constraints beside them, never the primary key.
- **Naming convention.** A table's prefix is its domain (`brew_` for operational brew-preparation reference data, `commerce_` for commerce parameters, and so on); snake_case throughout; `COMMENT ON` lines in `comments.sql` for every object, then `npm run catalog:md`.
- **Nothing hard-coded**: names, hosts, thresholds, mappings and stop lists live in tables or deploy config, never in code or view definitions.
- **The same rule on the frontend:** reuse the existing data doors. Cart state comes from `useCart()`, auth from `useAuth()`, API calls from `lib/api.ts`. No new `fetch` to an existing endpoint, no second copy of a value that another component already holds (the cart count is derived from `cart`, not stored again).

---

## Task 0 — Verify current state (write findings in the closing report before changing anything)

1. `frontend/src/app/components/Navigation.tsx` ~lines 160–176: the cart `<button>` has no `onClick` and its badge is the literal `0`. Confirm nothing else in the file reads `useCart`.
2. `PublicLayout.tsx`: `FloatingCart` is rendered for every public page, hidden while `usePrelaunchGated()` is true, wired to `toggleCartOpen` / `checkout` from `useCart()`. Confirm. `CartProvider` wraps the whole router in `App.tsx`.
3. `lib/prelaunch.ts`: `PRELAUNCH_OPEN_ROUTES` and the comment that already reserves a line for checkout. `App.tsx`: `/checkout/return` is wrapped `<PrelaunchGate><RequireAuth>…`. `PrelaunchGate` redirects to `/` when gated; at `/` a gated session renders `PreLaunch` (the curtain).
4. `backend/src/services/checkoutService.ts:186` (read only): `return_url` is built from `FRONTEND_URL`, which `deploy.yml` sets to `https://www.axisandbloomcoffee.com`. `backend/src/index.ts` accepts four origins (`www`, apex, `axis-and-bloom-prod.web.app`, `.firebaseapp.com`); `firebase.json` has no redirect between them. So a visitor who starts on apex or `.web.app` is sent back by Stripe to `www`, where that tab has no Firebase session and no `abPreview` flag. This is the most likely cause of (c). Confirm the four origins and the absence of a redirect.
5. `FlavorQuiz.tsx`: `QuizHeader` (~line 108) hides "SAVE PROGRESS" when `user` is set; the name screen (`if (!hasStarted)`, ~line 1495) shows "Already have a profile? Sign in →" (~line 1587) unconditionally. Signed-in users with an archetype never reach this screen (returning-user state ~line 1261); signed-in users without an archetype but with a first name skip it (~line 690). So the screen is seen by guests and by signed-in users who have no quiz result and no first name on the profile.
6. `frontend/src/main.tsx`: `initErrorReporter()` runs before `createRoot`. `.github/workflows/deploy.yml` ~line 250: `VITE_PRELAUNCH_MODE: 'true'` is where frontend build-time config lives. `frontend/.env.example` exists.

---

## Part A — Header cart icon (bugs a + b)

`Navigation.tsx`:

1. `const { cart, toggleCartOpen } = useCart();` and `const count = cart.reduce((n, i) => n + i.qty, 0);` (same reduction `FloatingCart` uses).
2. The cart `<button>` gets `onClick={toggleCartOpen}`. On the mobile panel, also close the panel if it is open (`setMobileOpen(false)`) before toggling, so the drawer is not under the menu.
3. The badge shows `count` and renders only when `count > 0` (same rule as the floating button). Keep the existing styling.
4. The icon is rendered only when `!gated` (the same `usePrelaunchGated()` value the file already reads for `navLinks`), matching `PublicLayout`'s rule for the floating cart: never show a door we won't open. With `?preview=true` the flag is false and the icon shows.
5. Nothing else changes: the drawer is still `FloatingCart` from `PublicLayout`; its Checkout button already navigates to `/checkout`; the floating 🛍 button stays. No nav entry for `/checkout`; the cart is the door.

`/find-my-flavor` has its own chrome and already renders `FloatingCart` itself; nothing to do there.

## Part B — `/checkout/return` leaves the pre-launch gate (bug c, part 1)

1. `lib/prelaunch.ts`: add `'/checkout/return'` to `PRELAUNCH_OPEN_ROUTES` with a one-line comment: a paid customer must always see the confirmation; Stripe's `return_url` carries no `preview` param. Replace the old "In late September the checkout route will be added here" sentence with that. `/checkout` itself stays gated (it is only reachable from the cart, which is hidden while gated).
2. `App.tsx`: unwrap `<PrelaunchGate>` from the `/checkout/return` route. `<RequireAuth>` stays: `GET /api/checkout/session/:id/status` is auth + ownership checked, and `RequireAuth` already carries `?session_id=` through `/sign-in?redirect=…`, so a customer whose session was lost still ends on the confirmation after signing in. Update the route comment.

## Part C — One canonical host (bug c, part 2)

Make the site settle on one address the moment it loads, so a visitor is never signed in on one host and sent back by Stripe to another.

1. New `frontend/src/app/lib/canonicalHost.ts`:
   - Reads `import.meta.env.VITE_CANONICAL_HOST` (a bare hostname, e.g. `www.axisandbloomcoffee.com`). Unset or empty → no-op, return `false`. This is the only switch; no hostname appears in code.
   - If `window.location.hostname !== VITE_CANONICAL_HOST`: `window.location.replace('https://' + host + pathname + search + hash)` and return `true`. Path, query (`?preview=true`, `?session_id=`, `?campaign=`, `?redirect=`) and hash are carried unchanged, so QR links (`/b/:token`), roastery links (`/roastery/:token`) and campaign links keep working on the canonical host.
   - Export one function, `redirectToCanonicalHost(): boolean`, with a comment that explains why (Firebase Auth and `sessionStorage` are per origin; Stripe returns to `FRONTEND_URL`).
2. `frontend/src/main.tsx`: call it first. If it returns `true`, do not render (the page is leaving). `initErrorReporter()` and `createRoot` run only when it returns `false`.
3. `.github/workflows/deploy.yml`, beside `VITE_PRELAUNCH_MODE`: `VITE_CANONICAL_HOST: www.axisandbloomcoffee.com` (the same host `FRONTEND_URL` uses on the backend step; note that in a comment so the two are changed together).
4. `frontend/.env.example`: add `VITE_CANONICAL_HOST=` with a one-line comment (leave empty locally). Add the variable to `frontend/src/vite-env.d.ts` only if the project declares its other `VITE_` variables there; otherwise leave the file alone.
5. Do not add a Cloudflare or Firebase Hosting redirect; this brief does it in the app so there is no manual step.

## Part D — Quiz name screen when signed in (bug d)

Decision (Dana, 2026-10-31): the "Whose palate are we profiling today?" screen stays, because a signed-in customer should be able to take the quiz for someone else in the household. It must not read like being signed out.

`FlavorQuiz.tsx`, name screen only (`if (!hasStarted)`):

1. Render "Already have a profile? Sign in →" only when `!user || user.isAnonymous` (the same test `QuizHeader` uses for "SAVE PROGRESS").
2. When `user && !user.isAnonymous`, show one quiet line above the `<h1>`, in the same small uppercase style the screen's micro-copy already uses (`fontSize: '0.68rem'`, `letterSpacing: '0.14em'`, color `#7b7f80`):
   `Signed in as {user.email} · profiling yourself or someone in your household`
   Dana may reword this after seeing it; put the string in one place at the top of the file as a named constant (UI copy, not a business value).
3. Nothing else on the screen changes. The returning-user state, the first-name skip and the campaign fast start are untouched.

## Part E — Acceptance (Dana, on prod after deploy, signed in as `danabar.mail+checkout1@gmail.com`)

Write the exact steps into the closing report; Dana runs them.

1. Open `https://axisandbloomcoffee.com/bloom?preview=true` (no www). Expect: the address bar becomes `https://www.axisandbloomcoffee.com/bloom?preview=true` before the page shows, and the site is unlocked.
2. On any page with the nav (`/bloom`, `/the-axis`, `/profile`): the header cart icon opens the drawer; the badge matches the floating button's count; the drawer's Checkout button lands on `/checkout`. On a phone width, the icon works with the menu closed and open.
3. Pay once with 4242 (one bag). Expect `/checkout/return` with Liam's line, the order line, ships-to and the total. This is the test that was never seen on prod. If it still lands anywhere else, stop and report the address bar and the first screen seen; do not add fixes.
4. Signed in, click "Find my flavor". Expect the name screen with the "Signed in as …" line and without "Already have a profile? Sign in →". Sign out, open `/find-my-flavor`: the line is gone and the sign-in link is back.
5. Checks: `npm run typecheck` and `vite build` in `frontend/`; the backend suite is untouched.

## Part F — Closing report

`backend/src/features/commerce/CLOSING_REPORT_CHECKOUT_UX_1.md`: Task 0 findings with file:line, what changed per part, the acceptance steps above with room for Dana's results, and anything observed but not fixed (listed, not done).
