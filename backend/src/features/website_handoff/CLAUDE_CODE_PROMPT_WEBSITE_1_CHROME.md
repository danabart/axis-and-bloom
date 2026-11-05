# Brief: Website 1 — tokens, header + Menu overlay, footer, shared primitives

**Workstream:** website_handoff (`backend/src/features/website_handoff/`) · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push (G1.6) · **Depends on:** nothing. Every later website brief builds on this one.

Read first: `README.md` in this folder (the merge rule, decisions D1–D13), `HANDOFF_SURVEY_2026-11-04.md` §0, `DEVELOPMENT_GUARDRAILS.md`, `frontend/src/design/CLAUDE.md`.

## Goal

Every public page renders inside the handoff's chrome: the handoff palette and type as tokens, the static header with "Sign in · Cart (n) · Menu", the full-width Menu overlay, the four-column footer with the newsletter field, and a small set of shared primitives (`Wrap`, `Caps`, `Titled`, `Btn`, `Frame`) the page briefs reuse. Nothing the current `Navigation.tsx` / `Footer.tsx` / `PublicLayout.tsx` do is lost.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/axis/index.html` (its `<style>` holds the base CSS; its header, `#siteMenu` and footer markup are the canonical ones; the other pages copy them) and `source/homepage-data/index.html` for the floating-over-hero variant (`.strip-hdr`) and `source/flavor-b/index.html` for the paper-on-dark variant (`.top.over`).

**Decisions already made (do not re-open):** D1 palette site-wide · D2 menu items and auth/admin/prelaunch behaviour · D3 Cart (n) links to `/cart`, drawer stays · D11 media via the registry.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G4.1 reuse shared components (Navigation, Footer, PublicLayout, FloatingCart, CartContext, AuthContext, prelaunch) · G4.2 nothing typed in that is data (the cart count, the year) · G4.3 `tsc --noEmit` clean, every public route verified live after deploy · G4.6 prelaunch curtain unchanged · G1.6 push is deploy, one closing report. No schema. Mode: test. STOP points: none.

## Task 0 — verify first (read-only; write findings to `CLOSING_REPORT_1.md` before any change)

1. Read `Navigation.tsx`, `Footer.tsx`, `PublicLayout.tsx`, `styles/theme.css`, `styles/fonts.css`, `lib/prelaunch.ts`, `context/AuthContext.tsx`, `context/CartContext.tsx`. List: every link the nav renders and under which condition (signed-in, admin, gated), the `[data-hero]` transparency contract, the no-footer routes, where `NewsletterModal` and `FloatingCart` mount, how `toggleCartOpen` is called.
2. Read the handoff header/menu/footer markup and CSS (files above). List every CSS custom property and class the pages share (`.wrap`, `.caps`, `.titled`, `.btn`, `.mark`, `.top`, `.site-menu`, `.sm-*`, `.foot`, `.frame`, `.ulink`) with their values.
3. Confirm `fonts.css` serves Lato 300/400/600/700 (the handoff uses 600 in `.btn`/`.site-nav`). Report which weights resolve.
4. Confirm `subscribeNewsletter` (`lib/api.ts`) and the `source` values it accepts; confirm `/privacy` and `/terms` routes.
5. Grep every page for `#9a2918`, `#a33726`, `#f2f1ea`, `#f0ebe1` and report counts per file (these move to tokens; the page briefs do the per-page swap, this brief only swaps the chrome and theme.css).
6. Confirm there is no `/cart` route yet (brief 8 adds it); this brief links to it anyway behind a feature flag described in Part B.

If anything contradicts this brief, STOP and report before Part A.

## Task 0.5 — Dana's manual steps

None.

## Part A — tokens and primitives

- `theme.css`: add `--ab-ink: #ba4c38`, `--ab-paper: #f1efe5`, `--ab-page: #ffffff`, the family colours already there, the handoff's `--ab-caps` tracking (`.24em`) and the `.wrap` max-width (1280px, 20px gutters). Map the old terracotta/beige variables to the new values so unredesigned pages shift with them (D1).
- `frontend/src/app/components/chrome/` (new folder): `Wrap`, `Caps` (the 12px/.24em uppercase label), `Titled` (eyebrow with the underline), `Btn` (56px, square, 1px border, arrow icon slot), `Frame` (8px photo frame), `ArrowIcon`. Each is a thin styled wrapper, props for `as`, `href`/`to`, `tone` (ink | paper). No page may re-implement these.
- Lato: keep `fonts.css`. Do not add the Google Fonts `<link>`.

## Part B — header and Menu overlay

Rebuild `Navigation.tsx` (same export, same mount point) as the handoff `.top` bar:

- Left: the five-path SVG mark + wordmark "Axis & Bloom" (from the handoff; put the SVG in `chrome/Mark.tsx`). Links to `/`.
- Right: `Sign in` (signed out) **or** `Profile · Sign out` (signed in) · `Cart (n)` with `n` = live quantity sum from `CartContext` (hidden while prelaunch-gated, as today) · `ADMIN` when `isAdmin` · `Menu` button (`aria-expanded`, `aria-controls="siteMenu"`).
- `Cart (n)`: `to="/cart"` once the route exists; until brief 8 lands it calls `toggleCartOpen` (one constant `CART_PAGE_ROUTE_EXISTS = false` in `Navigation.tsx`, flipped by brief 8). Keep the drawer toggle reachable either way (a small cart glyph button beside the count that calls `toggleCartOpen`).
- Variants by prop: `tone="ink"` (default, white page), `tone="paper"` (over dark photo; quiz), `floating` (absolute over the family panels; Home). Keep the `[data-hero]` contract working for pages that still use it until their brief lands.
- Menu overlay: port `#siteMenu` exactly (terracotta field, slide-down, staggered links, "Close"). Items from one array in `Navigation.tsx`: `01 Shop all → /shop`, `02 The Axis → /the-axis`, `03 The Bloom → /bloom`, `04 Find my flavor → /find-my-flavor`; mark the current route. Foot row: `Sign in · Cart (n)` (same rules) and the line "Coffee, personalized.". Under prelaunch the array is filtered to the gated set exactly as `GATED_LINKS` is today. Behaviours kept from the current hamburger: focus trap, body scroll lock, `role="dialog" aria-modal`, Escape and outside click close, focus returns to the Menu button.
- Mobile: one header for all widths (the handoff has no separate mobile bar); verify at 390px that `Sign in · Cart · Menu` fit; if not, collapse `Sign in` into the overlay foot row below 480px.

## Part C — footer

Rebuild `Footer.tsx` as the handoff `.foot` grid (4 → 2 → 1 columns at 900/560px):

- Col 1 mark + wordmark. Col 2 nav: The Axis, The Bloom Dial, Liam (`/sommelier`, hidden when `!hasLiamAccess` or gated), Find My Flavor, Cart (same rule as the header). Col 3: Instagram (`SHORTLINKS['/ig']` target from `App.tsx`), Contact (`mailto:` the business address already used on the site; Task 0 finds it), FAQ (omit the link until a `/faq` route exists; do not add a dead anchor). Col 4: the newsletter form "Your family of taste, in your inbox" posting through `subscribeNewsletter({ email, source: 'footer' })`; success state "You're on the list." in `Caps`; error state inline. Add `'footer'` to the accepted sources only if the endpoint validates them (Task 0).
- Bottom row: `© {currentYear} Axis & Bloom · Coffee matched to your personal flavor.` and real `Link`s to `/terms` and `/privacy`.
- `PublicLayout.tsx`: keep the no-footer route list and the curtain. `NewsletterModal` stays mounted.

## Part D — tests

- vitest: `Navigation` renders `Sign in` signed out, `Profile`/`Sign out` signed in, `ADMIN` for admins, `Cart (3)` for a cart of 3, nothing cart-related when gated; Menu overlay opens, traps focus, closes on Escape and returns focus. Footer form calls `subscribeNewsletter` with `source: 'footer'` and shows the success line.

## Acceptance

- `npx tsc --noEmit` adds no errors. Lints green.
- Screenshots at 390 and 1280 of `/`, `/bloom`, `/the-axis`, `/shop`, `/find-my-flavor`, `/sign-in`, `/profile`, `/checkout` (signed in, `?preview=true`), showing the new chrome and no overlap with page content. The unredesigned pages may look transitional; they must not break.
- Keyboard-only walk through the Menu overlay.

## Docs and closing

`WHAT_WE_BUILT.md` entry · `REGRESSION.md` (auth state in header, live cart count, gated set, overlay a11y, footer newsletter) · `OPEN_TASKS.md`: FAQ page wanted (design + copy), per-page palette swaps left to the page briefs · `CLOSING_REPORT_1.md` with Task 0 findings, screenshots, the list of files still carrying the old hex values.

## Do not

- Do not redesign any page body in this brief; chrome and tokens only.
- Do not add Google Fonts, do not touch `Shop.tsx` (retired by brief 4), do not add a `/cart` route (brief 8).
- Do not drop a link or behaviour the current nav has; list it if it cannot fit.
