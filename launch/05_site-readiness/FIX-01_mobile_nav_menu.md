# FIX-01 — Mobile navigation menu

> Workstream: site-readiness · Model: Sonnet · Depends on: nothing · One session, read the diff before deploy. Independent of the numbered launch steps.

CONTEXT: Axis & Bloom repo, React 18 + Vite SPA. `frontend/src/app/components/Navigation.tsx`
renders the main link row with `hidden md:flex` (introduced in commit `207c0ad`) and has
**no mobile alternative at all** — on phones there is no way to navigate the site. Paid
Instagram ads (mobile-dominant) start in early August; strangers must be able to move
around. The quiz layout hides the public nav entirely and must stay that way.

TASK:

1. **Audit first:** open `Navigation.tsx` and list every link/element in the desktop nav,
   plus any auth-dependent items (sign in / profile). The mobile menu must expose the same
   set — no link silently dropped, none added.
2. Add a mobile menu for viewports below `md`:
   - A minimal, calm trigger in the existing header bar (hamburger or "Menu" wordmark —
     match the site's existing type/icon language; no new icon library if one exists).
   - Opening reveals the same links as desktop, full-screen overlay or slide-down panel —
     pick whichever fits the existing design system; generous spacing, no cramping.
   - Closes on: link tap, close control, Escape, and route change.
   - Respect the brand: no bounce/flashy animation; a quiet fade/slide consistent with
     existing transitions. Calm Is a Feature.
3. Accessibility: the trigger is a `<button>` with `aria-expanded` + `aria-label`; focus
   is trapped in the open menu and returned on close; body scroll locked while open.
4. Desktop (`md` and up) renders exactly as today — zero visual change.
5. Layouts that intentionally hide the public nav (the quiz layout, and any admin layout)
   keep hiding it — the mobile menu must not leak into them.

HARD BOUNDARIES:
- Do NOT redesign the header or touch its desktop layout/styling.
- Do NOT modify the homepage's lifecycle personalization or Company Gift redemption
  widgets (standing warning in CAMILAS_UPDATES.md).
- Reuse existing components/transitions/design tokens; no new dependencies.

ACCEPTANCE — demonstrate each before finishing:
1. Mobile viewport: every public page shows the trigger; all desktop links reachable;
   open/close works via tap, Escape, and route change.
2. Desktop unchanged (side-by-side or diff of rendered header).
3. Quiz layout still shows no public nav on any viewport.
4. The audit list from Task 1 appears in your output with each link confirmed present
   in the mobile menu.
