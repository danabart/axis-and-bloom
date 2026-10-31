# Handoff — checkout UX bugs found on the first prod test (2026-10-31)

For a separate Cowork/Claude session. The Stripe work itself continues in the commerce session; this handoff is only about the site flow around it. Do not change `checkoutService`, `stripeWebhook`, `orderFinalizer`, `commerce_parameter` or anything under `services/fulfillment/` here; that code passed its acceptance and is live in test mode.

## Context

Commerce brief 1 (`CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md`, closing report `CLOSING_REPORT_1.md`) is deployed. Flow as built: Bloom Dial → add to cart (`CartContext`, `FloatingCart`) → cart "Checkout" button → `/checkout` (Stripe Embedded Checkout inside our page) → Stripe redirects to `/checkout/return?session_id=…` → return page polls `GET /api/checkout/session/:id/status` and shows Liam's order line. `/checkout` and `/checkout/return` sit under `PrelaunchGate` like `/bloom`.

Dana tested on prod signed in as `danabar.mail+checkout1@gmail.com`, entering via `/bloom?preview=true`. Payment, order, webhook and both emails all worked. The bugs are in the pages around it.

## Bugs observed (Dana's words, then the likely area)

**a. The cart icon in the top nav does nothing.**
Likely area: `PublicLayout.tsx` header cart icon vs `CartContext.toggleCartOpen` / `FloatingCart`. Check whether the header icon is wired to the same provider the Bloom page uses, and whether it works outside `/bloom`.

**b. No way to reach `/checkout` except by continuing the Bloom flow.**
Same root as (a): with the cart icon dead, the only Checkout button is the floating cart on the Bloom page. Decide where the cart lives site-wide (header icon opens the drawer on every page; drawer's Checkout goes to `/checkout`). No new nav entry for `/checkout` itself; the cart is the door.

**c. After paying, Dana landed on the quiz start page ("whose palate are we profiling today"), as if signed out, instead of `/checkout/return` with Liam's line.**
Most likely cause: the pre-launch gate, not auth. The bypass is a `sessionStorage` flag set by `?preview=true` (`frontend/src/app/lib/prelaunch.ts`). Stripe's `return_url` is `/checkout/return?session_id=…` with no `preview` param (`checkoutService.ts` ~line 186). If the flag is missing after Stripe's redirect, `PrelaunchGate` sends the user to the curtain at `/`, which is the quiz page. Fix options: exempt `/checkout/return` from the gate (a paid customer must always see their confirmation), or carry `preview=true` on the return URL while `PRELAUNCH_MODE` is on. Prefer the exemption; a paid order can never land on the curtain. Verify first by reproducing: pay, then check `sessionStorage` on the return page.
Second thing to check: the order WAS finalized (emails arrived), so this is display only, but confirm the return page also works when opened later from the confirmation email link, if there is one.

**d. Clicking "Find my flavor" in the nav while signed in shows the quiz entry "whose palate are we profiling today", which reads like being signed out.**
This is the quiz entry screen (`FlavorQuiz.tsx` / `Home.tsx` / `TheAxisV1.tsx`), the question that lets a signed-in user take the quiz for someone else (household). Dana's point: for a signed-in customer who already has a profile, "Find my flavor" should not look like a fresh start. Check (1) whether auth state is really lost on that route (compare with `/profile` right after) or only the copy implies it, (2) what the customer-lifecycle design says a returning customer should see when they click "Find my flavor" (retake for me / for someone else, with their name shown). Propose, don't assume; Dana decides the copy.

## Constraints that apply (CLAUDE.md + Dana's standing rules)

- CTO pattern: survey, options with trade-offs, Dana decides, then a Claude Code brief she runs. No PRs; she merges to main; push = prod deploy.
- Nothing hard-coded, nothing deleted from the DB, one writer per table, `COMMENT ON` + `catalog:md` for any schema change (none expected here).
- Don't add scope. Four bugs, one brief, unless (d) turns into a design question, in which case it gets its own decision first.
- Prod test data: the `+checkout1` account and its orders stay; they are test-mode rows.

## Useful reads

`frontend/src/app/context/CartContext.tsx`, `components/bloom/FloatingCart.tsx`, `components/PublicLayout.tsx`, `components/checkout/CheckoutPage.tsx`, `components/checkout/CheckoutReturnPage.tsx`, `components/PrelaunchGate.tsx`, `lib/prelaunch.ts`, `App.tsx` routes; `backend/src/features/commerce/CLOSING_REPORT_1.md` (Part E findings, including the address-form fallback fix 790f251).
