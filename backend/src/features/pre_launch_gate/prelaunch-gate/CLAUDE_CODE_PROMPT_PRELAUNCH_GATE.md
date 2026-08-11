# Feature: Pre-Launch Gate — route allowlist + trimmed nav + prelaunch ArchetypeSection

> Folder: `features/prelaunch-gate/` · Decided: 2026-08-11 (Dana) · Model: **Opus/Fable** (cross-cutting: routing + nav + shared component)
> Status: ✅ executed (2026-08-10) — see WHAT_WE_BUILT.md #156, and the "Execution notes" section below for two live deviations from this spec
> Context: Camila is starting to promote the quiz before the Oct 1 launch. The site must expose ONLY the quiz funnel until launch. Launch day stays exactly what it already is: flip `VITE_PRELAUNCH_MODE` off, one flag, nothing else.

CONTEXT: Today `VITE_PRELAUNCH_MODE=true` (set in `.github/workflows/deploy.yml`) shows the `PreLaunch.tsx` curtain at `/` via the `HomeOrPrelaunch` component in `frontend/src/app/App.tsx` — but ONLY at `/`. Every other route (`/bloom`, `/shop`, `/coffees`, `/flavor-intelligence`, `/sommelier`, `/how-it-works`, etc.) is fully reachable by URL or nav link. There is no checkout; nothing is purchasable before Oct 1. A team bypass already exists: visiting `/?preview=true` sets a `sessionStorage` flag that skips the curtain for the browser session.

This task extends the same flag from "curtain on the homepage" to a site-wide **allowlist**, in three layers. It creates no new subscribe paths, no new page designs, and no parallel mechanisms — it reuses `VITE_PRELAUNCH_MODE`, the existing sessionStorage preview bypass, and the existing shared components.

TASK:

## 1. Route allowlist (App.tsx)

While `VITE_PRELAUNCH_MODE=true` and the preview bypass is NOT set, only these routes are reachable:

- `/` (the existing curtain via `HomeOrPrelaunch` — unchanged)
- `/find-my-flavor` (the quiz, including its results/gate flow)
- `/sign-in`
- `/profile` (already wrapped in `RequireAuth` — keep that)
- `/the-axis`
- `/about`
- `/terms`, `/privacy`
- `/admin` and all its children (already behind `requireAdmin` — the gate must not add anything in front of it)
- `/b/:token` (QR door — token-gated, effectively invisible without a valid token; roastery pilots must keep working)

Every other route — `/bloom`, `/shop`, `/coffees`, `/coffee/:id/story`, `/flavor-intelligence`, `/how-it-works`, `/join-household`, `/sommelier`, and any route not listed above — redirects to `/` (the curtain). Use a single wrapper/guard applied in `App.tsx`, not per-page edits.

Implementation requirements:

- Define the allowlist as ONE exported constant (e.g. `PRELAUNCH_OPEN_ROUTES` in a small `prelaunch.ts` util next to the existing prelaunch logic). In late September the checkout route will be added to this list — one line, no refactor. Add a short comment saying exactly that.
- The static `/match/*` share pages are pure static HTML served outside the React router — do NOT touch them; they stay live and crawlable.
- When the flag is off (launch day), the guard must compile away to a pass-through: zero behavior change, zero extra renders. Removing/falsifying `VITE_PRELAUNCH_MODE` in `deploy.yml` remains the complete launch switch.

## 2. Preview bypass (team access)

Extend the existing `?preview=true` sessionStorage bypass so it unlocks the WHOLE site, not just the curtain:

- Appending `?preview=true` to ANY route (not only `/`) sets the existing sessionStorage flag and lets the request through; from then on the whole session bypasses the gate — same key, same semantics, same reset-on-browser-close behavior the team already knows.
- Do not introduce a second flag or a login-based bypass; sessionStorage is the mechanism.

## 3. Trimmed navigation + footer on open pages

While gated (flag on, no bypass), `Navigation.tsx` shows only: logo (→ `/`), Find My Flavor, The Axis, About, and the sign-in / profile entry (keep the existing real-account-vs-guest logic from the guest-identity work — anonymous guests must NOT see Sign out / profile icon, per the #120 fix). Links to Bloom, Coffees, Shop, How It Works, Flavor Intelligence, Liam disappear — they are removed from the rendered nav, not disabled or grayed (never show a door we won't open). Apply the same sweep to the footer: any footer link pointing at a hidden route is omitted while gated. The mobile nav (FIX-01) gets the identical trimmed set.

## 4. Prelaunch mode for ArchetypeSection (results screen + /profile)

`ArchetypeSection` (shared by the quiz results screen, Find My Flavor's returning-user screen, and `/profile`'s Flavor Memory tab) currently renders, via its children (`DialArchetypeSection`, `RevealedPanel`, `TastingNotes`, cart wiring): **Add to Cart** (into the shared `CartContext` / floating cart — with no checkout behind it), **"Talk to Liam →"** links (→ `/sommelier`, hidden), and **"Explore the full breakdown →"** (→ `/flavor-intelligence`, hidden).

While gated:

- Hide Add to Cart, the floating cart entry point, Compare's any-links-into-hidden-pages, the Liam links, and the flavor-intelligence links from every `ArchetypeSection` surface. The dial, position card, reveal panel (cupping notes / flavor wheel content), and "Your flavor profile →" link all remain — the substance stays generous; only doors into hidden rooms are removed.
- Do this by threading ONE new optional prop (e.g. `prelaunch` — default `false`) through the existing component chain, exactly like the `hideProfileLink` prop precedent. Do NOT fork or duplicate any component, and do NOT reimplement dial/card/reveal/cart logic (standing project rule).
- Derive the prop from the same single source of truth as the route guard (the `prelaunch.ts` util + bypass check), so `?preview=true` also restores the full component for the team.
- No placeholder copy where elements were removed — omit them cleanly. If a layout hole genuinely needs a line, it names what's coming ("First access opens October 1"), never what's absent.

## 5. Leave alone

- The quiz firm email gate (Step 04) — unchanged, it is the funnel.
- `PreLaunch.tsx` curtain content and its subscribe form — unchanged.
- All backend routes, `blockAnonymousAuth`, lifecycle machinery — unchanged (this is a frontend visibility gate, not a security boundary; the real protections already live server-side).
- Static `/match/*` share pages — untouched.
- Homepage widgets and lifecycle CTAs behind the curtain — untouched (they're simply unreachable while gated).

CONSTRAINTS: follow existing frontend structure (`frontend/src/app/...`); one allowlist constant, one prop, one bypass mechanism; no new dependencies; positive-register rule applies to any user-visible string (never name what's unavailable). This frontend's `vite build` does NOT type-check — run `npx tsc --noEmit` (or verify live) in addition to `vite build` before calling it done.

ACCEPTANCE:

1. With the flag on, direct URL navigation to EVERY hidden route (`/bloom`, `/shop`, `/coffees`, `/coffee/1/story`, `/flavor-intelligence`, `/how-it-works`, `/join-household`, `/sommelier`) lands on the curtain; every allowlisted route renders normally. Demonstrate at least `/bloom` and `/sommelier` by real browser navigation, not code reading.
2. `axisandbloomcoffee.com/bloom?preview=true` (any hidden route) unlocks the full site for the session; closing the browser resets it.
3. On `/find-my-flavor`, `/the-axis`, `/about`: nav and footer show only the trimmed set; mobile nav matches.
4. A real guest quiz completion through the email gate shows the results screen with dial + reveal panel intact but NO Add to Cart, no cart icon, no Liam link, no flavor-intelligence link; same on `/profile` for a signed-in account. With `?preview=true`, all of it returns.
5. `/b/:token` with a valid token still renders; `/admin` still works for an admin account.
6. With the flag OFF locally, `git diff`-level confidence that behavior is byte-identical to today: full nav, full ArchetypeSection, all routes open — launch remains a one-flag flip.
7. `vite build` clean AND `npx tsc --noEmit` clean.

## Execution notes (added 2026-08-10, live during implementation)

Dana made two live corrections while this was being verified in a real browser, both **closing** routes this spec listed as open — the allowlist actually shipped is smaller than §1 above:

1. **`/about` is closed too**, not open. Reason given: it's an old page only ever linked from the admin nav, not part of the live customer-facing site. Its own inline footer (`TasteFinderSection.tsx`, shared with `Home.tsx`) briefly leaked `/coffees`/`/shop` links and an after-quiz "See your coffees →" card link while gated — found live, then made moot by closing the route outright (so those edits were reverted rather than kept as redundant defense-in-depth).
2. **`/the-axis` is closed too**, not open — a separate live call, no reason recorded beyond the instruction itself.

`PRELAUNCH_OPEN_ROUTES` (`frontend/src/app/lib/prelaunch.ts`) and the trimmed nav (`Navigation.tsx`'s `GATED_LINKS`) reflect the shipped, smaller allowlist — `/`, `/find-my-flavor`, `/sign-in`, `/profile`, `/terms`, `/privacy`, `/admin`, `/b/:token`. The gated nav is just logo → `/` + Find My Flavor + sign-in/profile icon, not the four-item set §3 describes.

Also raised, explicitly deferred to a future pass (not implemented here): stop showing the archetype/dial on-page immediately after the email gate, and show a "check your email" confirmation instead — Email 1 of the Mailchimp Welcome Journey (`WHAT_WE_BUILT.md` #117) already contains the full match reveal, so the pieces exist, but this changes the core quiz funnel's conversion behavior and needs its own spec + a decision made with Camila, not a mid-execution addition to this gate task.
