# Brief: Website 8 — Sign in, the `/cart` page, checkout restyle

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster (no money logic changes; the Stripe flow is untouched) · **Mode:** test · **Depends on:** brief 1. Independent of 2–7.

Read first: `README.md` (merge rule, D2, D3, D8, D13), `HANDOFF_SURVEY_2026-11-04.md` §6, `backend/src/features/commerce/README.md` + `CLOSING_REPORT_CHECKOUT_UX_1.md` + `HANDOFF_CHECKOUT_UX_BUGS_2026-10-31.md`, `backend/src/features/bag_qr/` (the two-door page's sign-in links), `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/account/build.py` (generator for both pages; `line()` is the cart line, `.acct`, `.cline`, `.csum`, `.ah`, `.side` the CSS) and `signin/index.html`, `cart/index.html`.

## Goal

1. `/sign-in` looks like the handoff ("Welcome back.", underline fields, paper side panel "New here?") and does everything `SignIn.tsx` does today.
2. `/cart` exists as the handoff page (dynamic headline, lines with image and stepper, empty state, summary, Checkout) built on the cart pieces that exist; the drawer stays.
3. `/checkout` and `/checkout/return` take the tokens and chrome; no logic change.

**Decisions already made (do not re-open):** D8 (two tabs, names on create, Google + Apple, forgot, `?redirect=`/`?quiz_id`/`?mode=signin`, states) · D3 drawer stays, header links to `/cart`, add-to-cart opens the drawer as today · D13 shipping line from `getCheckoutRules()`, no typed shipping/tax copy · D14 the handoff's note "Roasted to order · ships within the week" is dropped; `/cart` carries no timing text at all. Order facts (sent to the roastery, shipped on a date) are shown where orders are shown today (Profile, from `v_order_status`), not in the cart · quantity: add `setQuantity(index, qty)` to `CartContext` (one writer of cart state), used by the stepper; `removeFromCart` on 0 · subscription choice shows on `/cart` with the same `SubscribeChoice` as the drawer (one component) · signed-out `/cart` shows "Sign in to check out" → `/sign-in?mode=signin&redirect=/checkout` (today's rule) · cart persistence (reload) is **not** in scope; recorded in OPEN_TASKS · line image = the family photo via the slug (`shopAssets.family` from brief 4 if landed, else `archetypeAssets.*.sm1`); the "tier"/Premium line uses `positionLabel` and the award flag only if the item carries them (Task 0), otherwise the meta line is "{family} · {weight} oz whole bean".

**Guardrails.** G4.1 reuse `SignIn.tsx` logic, `CartLines`, `SubscribeChoice`, `SubtotalLine`, `ShippingLine`, `useCart`, `getCheckoutRules`, `RequireAuth`, `PrelaunchGate`, chrome primitives · G4.2 nothing typed in (prices, shipping, tax, promise) · G4.3 · G4.6 `/cart` behind `PrelaunchGate`, like `/checkout` · G3.6 no auth change · G1.6. No schema. STOP: none.

## Task 0 — verify first (`CLOSING_REPORT_8.md`)

1. `SignIn.tsx`: tabs, providers, `friendlyError`, reset flow, redirect params, `quiz_id` back link; every caller of `/sign-in` and its params (`QrDoor`, `FlavorQuiz`, `Home`, `Profile`, `FloatingCart`, `TasteFinderSection`); the current default tab.
2. `CartContext.tsx`: the item union and fields, `isSameLine`, `addToCart` auto-open, `removeFromCart`, `subscription`; `CartLines.tsx`, `FloatingCart.tsx`, `CheckoutPage.tsx` (what each renders and from which rule field).
3. `Navigation.tsx` from brief 1: the `CART_PAGE_ROUTE_EXISTS` flag to flip.
4. The handoff pages' markup and CSS.

## Part A — sign-in

Restyle `SignIn.tsx` (same export, same route): left column = caps label "Sign in" / "Create profile" as two `Caps` tabs (design style; `?mode=signin` selects the second; default stays what Task 0 found), h1 "Welcome back." / "Begin your profile." per tab, the paragraph as drawn, underline fields (email, password; first/last name on create), "Forgot your password?" (reset flow + "sent" state in `Caps`), primary `Btn`, error line in `Caps` ink, loading disables the button; under the form: Google and Apple as `Btn` outlined ("Continue with Google / Apple"); `quiz_id` "← Back to results" above the h1. Right column = paper `.side` panel "New here?" (its "Seven questions" line uses `facts.questions` from `getHomeContent()`, D15) with the two links as drawn ("Begin my profile" → quiz, "Or turn the dial first" → `/bloom`). The current left photo panel is retired. `redirect` preserved on every path.

## Part B — `/cart`

- Route `/cart` in `App.tsx` under `PrelaunchGate` (no `RequireAuth`). Flip `CART_PAGE_ROUTE_EXISTS`; `Cart (n)` in header, overlay and footer link here; the drawer's "Checkout" stays as is.
- Page: `.acct.cartg` grid; headline from the count ("Nothing yet." / "One thing, so far." / "Two things, so far." / "{n} things, so far."; a tiny `numberWord` util for 1–9, digits above); lines = `CartLines` with a `variant="page"` that adds the image, the meta line, the stepper (−/+ → `setQuantity`, 0 removes) and Remove; collection lines as today with the discount strike-through; empty state as drawn with "Turn the dial" → `/bloom` and "Continue shopping" → `/shop`.
- Summary: `SubtotalLine`, `ShippingLine` (rules), `SubscribeChoice`, Total (estimate, the same figure `CheckoutPage` computes; reuse its hook), Checkout `Btn` → `/checkout` or the sign-in redirect. No promise line.
- `useCart` is the only cart state; no local copy.

## Part C — checkout

`CheckoutPage` and `CheckoutReturnPage`: swap colours/type to the tokens and the chrome primitives for headings, labels, buttons; the Stripe embed, the address selector, the error handling and the empty redirect are untouched.

## Part D — tests

vitest: sign-in tabs and `?mode`, redirect preserved after email, Google and Apple sign-in, reset sent state, error mapping, back-to-results link; `/cart` headline per count, stepper calls `setQuantity`, 0 removes, empty state, signed-out checkout link carries the redirect, gated route; `CartContext.setQuantity` merges with `isSameLine`.

## Acceptance

Live `?preview=true`: screenshots 390/1280 of sign-in (both tabs, error state), `/cart` (empty, two lines, a collection line), `/checkout`; a test-mode checkout completes from `/cart` → `/checkout` → `/checkout/return`; `/b` two doors still land on the right tab with the redirect.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (providers, redirect params, QR doors, drawer + page, stepper, gated cart), `OPEN_TASKS.md` (cart persistence across reload; per-line coffee photo when brief 2's photo key is filled), `CLOSING_REPORT_8.md`.

## Do not

- Do not remove Google/Apple, create-profile, reset, `redirect`/`quiz_id`/`mode` handling.
- Do not type shipping, tax or price copy; no roasting or delivery promise anywhere (D14); do not touch the Stripe flow or any money logic.
- Do not add cart persistence or promo codes.
