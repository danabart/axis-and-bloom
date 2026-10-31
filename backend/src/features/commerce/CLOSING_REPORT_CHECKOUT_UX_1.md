# Closing report — Checkout UX 1: the pages around checkout

Brief: `CLAUDE_CODE_PROMPT_CHECKOUT_UX_1.md` · Session 2026-10-31 · Base commit `0a278aa` (main == origin/main), prod rev `axis-bloom-backend-00805-6j7`.

## Task 0 — current state (written before any change)

Line numbers are at base commit `0a278aa`. Paths under `frontend/src/app/` unless noted.

**1. Header cart icon: confirmed dead.** `components/Navigation.tsx:160-173`: the cart `<button>` has no `onClick`, and its badge is the literal `0` (`:172`). The file's imports (`:1-6`) do not include `useCart`, and nothing else in the file reads the cart.

**2. Floating cart: confirmed, one correction.** `components/PublicLayout.tsx:48-57` renders `FloatingCart` only when `!gated`, wired to `toggleCartOpen` and `checkout` from `useCart()` (`:13`). The drawer opens with an empty cart ("Your cart is empty"), so the header icon always has something to open. Correction to the brief: `CartProvider` does not wrap the router, it sits inside `<BrowserRouter>` (`App.tsx:98`) so that `checkout()` can navigate. It still wraps every route, so `useCart()` in `Navigation` is safe.

**3. Gate: confirmed, one finding on what the customer sees.** `lib/prelaunch.ts:20-21` holds the "late September" sentence, the list is at `:31`. `App.tsx:201` wraps `/checkout/return` in `<PrelaunchGate><RequireAuth>`. `PrelaunchGate` is a `<Navigate to="/" replace />` when gated, and `/` renders `PreLaunch` when gated (`App.tsx:67-71`).

`PRELAUNCH_OPEN_ROUTES` is documentation only: `PrelaunchGate` never reads it, and neither does any other code. The real change in Part B is the `App.tsx` unwrap; the list entry records it.

**Finding: the curtain is not the screen Dana described.** The curtain's headline is in `PreLaunch.tsx:168-171`; it does not contain "Whose palate are we profiling today?". That text exists only in `FlavorQuiz.tsx:1538` (the name screen) and `Home.tsx:378` (the ungated home, signed out or guest). So the gate alone sends a customer to the curtain, one "Find my flavor →" click (`PreLaunch.tsx:182`) short of the screen in the report. The handoff's "the curtain … is the quiz page" is not accurate. Either the report compresses that click, or `Home` was served, which would mean an ungated session that was signed out. That points the same way (a different host, no Firebase session) but is not proven. Part E step 3 is the test, and the brief already says to stop and report if it lands anywhere else.

**4. Hosts: confirmed from the code; the live edge could not be probed from here.** `backend/src/services/checkoutService.ts:186` builds `return_url` from `FRONTEND_URL` (`:31`), and `.github/workflows/deploy.yml:170` sets it to `https://www.axisandbloomcoffee.com`. `backend/src/index.ts:78-81` accepts the four origins. `firebase.json` has no redirect.

- `www` and apex answer curl with a 403, with or without a browser user agent (the Cloudflare layer blocks scripted requests), so "no Cloudflare redirect" is not confirmed from the command line. Acceptance step 1 shows it either way.
- `.web.app` and `.firebaseapp.com` answer 200 with no redirect.
- `sessionStorage` survives a same-tab round trip through Stripe on the same origin. So a session that started on `www` keeps its flag and its Firebase sign-in, and the failure needs a different starting host. Dana's starting host for the first purchase is not recorded, so the cause stays "most likely".

Checked for Part C, since a redirect on every load could break these:
- Firebase Auth's own pages are safe: `VITE_FIREBASE_AUTH_DOMAIN` is `axis-and-bloom-prod.firebaseapp.com`, and `/__/auth/handler` there is served by Firebase (200), outside our bundle, so `main.tsx` never runs on it.
- `www` is in Firebase Auth's authorized domains (read from the Identity Toolkit config).
- No Hosting preview channels exist (`deploy.yml` is the only workflow, with no `hosting:channel`), so nothing else needs `.web.app` to stay usable.
- `backend/src/routes/newsletter.ts:312` emails an apex link. It will now forward to `www`, which is fine.

**5. Quiz name screen: confirmed, one mismatch in the brief.** `FlavorQuiz.tsx:1495` is the name screen, and the sign-in link is unconditional (text at `:1601`). The returning-user state starts at `:1260`, the first-name skip at `:690`. The screen is seen by guests and by signed-in users with no quiz result and no first name, and the `+checkout1` account fits that.

**Mismatch:** Part D calls `!user || user.isAnonymous` "the same test `QuizHeader` uses". `QuizHeader` actually uses `!user` (`:123`), so a Firebase anonymous guest sees neither "SAVE PROGRESS" nor, today, a different treatment. I follow the brief's explicit condition, because an anonymous guest has no email to show and does need the sign-in link. `QuizHeader` is left alone.

**6. Build config: confirmed.** `frontend/src/main.tsx:11` runs `initErrorReporter()` before `createRoot`. `deploy.yml:250` holds `VITE_PRELAUNCH_MODE`. `frontend/.env.example` exists. `frontend/src/vite-env.d.ts` is only the Vite reference and declares no `VITE_` variable, so per Part C.4 it stays untouched.

**7. Typecheck: the brief's command does not exist, and the baseline is not green.** `frontend/package.json` has no `typecheck` script (only `dev`, `build`, `preview`), and CI does not typecheck the frontend. `npx tsc --noEmit` at the base commit reports **13 errors in 6 files, all before this brief**: `bloom/useAdjacentArchetype.ts` (3), `Profile.tsx` (3), `Footer.tsx` (3), `TheAxis.tsx` (2), `bloom/ArchetypeSection.tsx` (1), `Home.tsx` (1). None is in a file this brief changes. Fixing them is outside the four bugs, so the check here is "the same 13 errors before and after".

## What changed

Frontend plus one deploy line. No backend file, schema, DB write, table or route. Nothing on the brief's "Do not touch" list changed.

**Part A, header cart icon (bugs a + b).** `Navigation.tsx` reads `cart` and `toggleCartOpen` from `useCart()`, and the count is derived with the same reduction as `FloatingCart`. The icon toggles the shared drawer and closes the mobile menu first. The badge shows the count only when it is above 0. The icon renders only when `!gated`.

**Part B, `/checkout/return` leaves the gate (bug c, part 1).** `App.tsx` drops `<PrelaunchGate>` from that route and keeps `<RequireAuth>`. `lib/prelaunch.ts` lists it with the reason and loses the "late September" sentence. `/checkout` stays gated.

**Part C, one canonical host (bug c, part 2).** New `lib/canonicalHost.ts` exports `redirectToCanonicalHost()`. `main.tsx` calls it first and runs `initErrorReporter()` and `createRoot` only when it returns `false`. `deploy.yml` sets `VITE_CANONICAL_HOST: www.axisandbloomcoffee.com` beside `VITE_PRELAUNCH_MODE`, with a comment tying it to `FRONTEND_URL`. `.env.example` gains the empty variable. `vite-env.d.ts` is untouched (Task 0 item 6).

**Part D, quiz name screen (bug d).** In `FlavorQuiz.tsx`, the sign-in link renders only when `!user || user.isAnonymous`. A signed-in customer sees the "Signed in as …" line above the `<h1>`. The copy is one named function at the top of the file (`signedInNameScreenLine`), because it takes the email. Most of the diff there is re-indentation of the link.

## Checks run

| Check | Result |
|---|---|
| `npx tsc --noEmit` in `frontend/` (no `typecheck` script exists) | **Not green: 13 errors, the same 13 as the base commit** (compared with line numbers removed). None in a changed file. |
| `vite build` | Green |
| Backend suite | Not run; no backend file changed |
| Browser, local production build with `VITE_PRELAUNCH_MODE=true` | 34 of 34 on the final runs (below) |

**Browser checks** used Playwright against throwaway builds outside the repo. Reads came from prod. Writes were dropped, and Firebase was answered inside the browser, so no account or row was created anywhere.

- **Gated:** the header icon and floating cart are hidden; `/bloom` and `/checkout` still go to the curtain.
- **`/checkout/return`, gated:** a guest goes to `/sign-in` with `session_id` intact in `redirect`; a signed-in user stays on the page and does not see the curtain.
- **Cart, desktop:** the icon opens and closes the drawer on `/bloom` and `/the-axis`; there is no badge on an empty cart; after adding a bag, header and floating counts both read 1; signed out, the drawer's button goes to `/sign-in?redirect=/checkout`.
- **Cart, 390px phone:** the icon works with the menu closed; with the menu open, the menu closes and the drawer opens.
- **Canonical host:** on another host the page replaces itself with the canonical address, keeping path, query and hash, and does not render; on the canonical host it stays and renders.
- **Name screen:** a guest sees the sign-in link and no line; a signed-in user sees the line and no link, on a screen that stays.

**Two failures on the way, both caused by the test setup, not the code.** Blocking Firebase kept `RequireAuth` on "Loading", because the app waits for anonymous sign-in. Stubbing the quiz questions as empty hid the name screen. The results above are from the corrected runs.

**Not covered locally (Part E covers them):** a real Stripe payment and return, the drawer's signed-in Checkout button reaching `/checkout`, a real signed-in account (that identity was simulated in the browser), and the Cloudflare layer in front of `www` and apex.

## Part E — acceptance (Dana, on prod, signed in as `danabar.mail+checkout1@gmail.com`)

**The cart lives in memory, so a full page load empties it.** Once a bag is in the cart, move between pages with the site's links, not by typing an address. A badge that drops to nothing after a typed URL is expected.

1. Open `https://axisandbloomcoffee.com/bloom?preview=true` (no www). Expect: the address bar becomes `https://www.axisandbloomcoffee.com/bloom?preview=true` before the page shows, and the site is unlocked. Sign in if asked; a session on the old host does not carry over.
   - Result:
2. Add a bag on `/bloom`, then click through to `/the-axis` and `/profile`. On each, the header cart icon opens the drawer and the badge matches the floating button's count. The drawer's Checkout button lands on `/checkout`. At phone width, the icon works with the menu closed and open.
   - Result:
3. Pay once with 4242 (one bag). Expect `/checkout/return` with Liam's line, the order line, ships-to and the total. This is the test that was never seen on prod. **If it lands anywhere else, stop and report the address bar and the first screen seen; do not add fixes.**
   - Result:
4. Signed in, click "Find my flavor". Expect the name screen with the "Signed in as …" line and without "Already have a profile? Sign in →". If the account now has a quiz result, you get the returning-user screen instead, and that is correct. Sign out, open `/find-my-flavor`: the line is gone and the sign-in link is back.
   - Result:
5. Checks, already run in this session: see the table above. Typecheck is the same 13 existing errors, not green.

## Observed, not fixed

1. **The Bloom card says "shipping included", and the cart then adds $5.95.** `bloom/DialArchetypeSection.tsx:378` shows it next to "12 oz · $29.00"; the drawer shows "Shipping · free with 2 bags, $5.95". A customer sees this before paying. It needs its own decision on the copy.
2. **The consent banner covers the cart drawer until it is answered.** The banner is at `zIndex: 10000` (`ConsentBanner.tsx:35`), the drawer at `z-[60]`. On a 390px phone it hides the drawer's Checkout button. This applies to the floating cart today too.
3. **Frontend typecheck:** no script, no CI step, 13 standing errors (Task 0 item 7). The brief's "`npm run typecheck` in `frontend/`" cannot run as written.
4. **"SAVE PROGRESS" is effectively never shown.** `QuizHeader` tests `!user` (`FlavorQuiz.tsx:123` at base), and every visitor is signed in anonymously by `AuthContext`, so once that completes a guest has a `user` too. The link probably disappears for everyone shortly after load. Not tested live.
5. **Quiz name screen on a phone:** the headline, input and new line all run to the right edge, because the block has a left offset and no right margin. Nothing is clipped at 390px. It is the same for the existing elements.
6. **The cause of bug (c) is still "most likely".** See Task 0 item 3: the curtain does not carry the headline Dana reported, and the starting host of the first purchase is not recorded. Parts B and C cover both routes, and Part E step 3 is the proof.
7. **Handoff question not answered by this brief:** does the return page work when opened later from an email link? `/checkout/return` now only needs sign-in plus ownership, so it should, but it was not exercised.
8. **Signed-in customers with a quiz result on the old host:** anyone signed in only on apex or `.web.app` will have to sign in once on `www`. Their old host's session is not carried across.
