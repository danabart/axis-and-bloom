# Closing report — Website 1 (chrome: tokens, header + Menu overlay, footer, primitives)

Brief: `CLAUDE_CODE_PROMPT_WEBSITE_1_CHROME.md` · Run: 2026-11-04 · Mode: test, then push (G1.6).

## Task 0 — findings (read-only, written before any change)

### 0.1 Current chrome

**`Navigation.tsx`** (240 lines), fixed 46px bar, `z-index:100`.
- Logo `brandAssets.logoQuarter1` + "AXIS & BLOOM" → `/`.
- Text links (desktop ≥md only): `FULL_LINKS` = THE AXIS `/the-axis`, THE BLOOM `/bloom`, FIND MY FLAVOR `/find-my-flavor`, FLAVOR INTELLIGENCE `/flavor-intelligence`, plus ADMIN `/admin` when `isAdmin`. While gated: `GATED_LINKS` = FIND MY FLAVOR only, and no ADMIN.
- Icons: User → `/profile` when `user && !isGuest`, otherwise `/sign-in` (always shown). "Sign out" text button when `user && !isGuest` (desktop; also in the mobile panel), which calls `logout()` and then `navigate('/')`. Cart icon + pink count badge (`count = Σ qty`, badge only when >0), hidden while gated; click → `setMobileOpen(false); toggleCartOpen()`.
- Hamburger (<md only): `aria-expanded`, `aria-controls="mobile-nav-panel"`, panel `role="dialog" aria-modal="true" aria-label="Site menu"`. Body scroll lock, Escape closes, Tab focus trap, focus returns to the trigger, closes on route change. **No outside-click close today.**
- `[data-hero]` contract: an IntersectionObserver on `document.querySelector('[data-hero]')`. While the hero is in view the bar is transparent with `#f2f1ea` links; otherwise it is `#f2f1ea` with `#9a2918` links. Only `Home.tsx:330` sets `data-hero`.

**`Footer.tsx`** (80 lines), `#f2f1ea`. Brand + "Coffee matched to your personal flavor. Discover what feels like you." · Explore: Find my flavor, Flavor Intelligence (hidden while gated) · Company: Contact `#contact`, Instagram `#instagram` (both dead anchors) · "© 2026" (typed in) · real `Link`s `/privacy`, `/terms`. No newsletter form.

**`PublicLayout.tsx`**: under prelaunch on `/` it renders only `<Outlet/>` (the curtain), with no nav and no footer. The no-footer routes are `/`, `/about`, `/find-my-flavor`, and `/sommelier` when `hasLiamAccess`. The comment says `/` and `/about` render the Footer inside `TasteFinderSection`, but that is stale: nothing imports `Footer` except `PublicLayout`, so those two pages have no footer. `NewsletterModal` is always mounted. `FloatingCart` mounts at layout level when `!gated` (`items=cart, open=cartOpen, onToggle=toggleCartOpen, onRemove, onCheckout=checkout, isSignedIn=!!user`).

**`toggleCartOpen`** callers: Navigation (cart icon) and PublicLayout → `FloatingCart.onToggle`. `addToCart` also sets `cartOpen=true`.

**`lib/prelaunch.ts`**: `usePrelaunchGated()` = `VITE_PRELAUNCH_MODE && !?preview=true` (sessionStorage `abPreview`). **`AuthContext`**: `user, isAdmin, hasLiamAccess, isGuest (= anonymous), logout`. **`CartContext`**: `cart[] {qty}`, `cartOpen`, `toggleCartOpen`, `addToCart`, `removeFromCart`, `checkout` (→ `/checkout`).

**Things that depend on the fixed 46px bar.** Pages pad their own tops (`pt-32`, `pt-24/40`, `py-12/20`), so a static header only adds space. Sticky or fixed offsets: `BloomPage.tsx:278` jump-nav `sticky top:64`, `Sommelier.tsx:491` chat `fixed top:64`, `TheAxis.tsx:180` `sticky top:96`, `FlavorIntelligencePage` `lg:top-24`, `Shop.tsx:333` `sticky top:80` (not touched, brief 4), and `BloomDial` `scrollMarginTop 70/130`.

### 0.2 Handoff shared CSS (`source/axis/index.html` `<style>`)

- Body: `background:#ffffff; color:#ba4c38; font-family:'Lato',Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased`. No CSS custom properties beyond `color-scheme:light`; every colour is a literal: ink `#ba4c38`, paper `#f1efe5`, page `#ffffff`, hairline `rgba(186,76,56,.35)`, paper hairline `rgba(241,239,229,.45)`. Mark SVG fills: `#c24526` / `#e9526f` (paper variant: `#f1efe5` at 1 / .7).
- `.caps` 12px · `.24em` · uppercase · 700. `.titled` inline-flex column, gap 10px, `::after` 1px currentColor underline at 100%. `.wrap` max-width 1280, padding-inline `max(20px, safe-area)`.
- `.top` flex, space-between, gap 24, wrap, `padding-block:clamp(20px,3vw,36px)`. Static (in flow). `.mark` gap 10, span 12px/.24em/400/uppercase. Mark SVG 20×22.
- `.site-nav a` 600 with a scaleX underline on hover/`.on` (pages use `.menu-btn` for the same effect). `.menu-btn` is caps-style with the same underline.
- `.btn`: min-height 56, padding 0 32, 11px/.26em/600 uppercase, 1px currentColor border, transparent; hover background `#ba4c38`, colour `#f1efe5`, transition .2s. `.ulink` 1px bottom border, hover opacity .7. `.frame` 1px currentColor border, padding 8, img 4:3 cover.
- `.site-menu`: fixed `inset:0 0 auto 0`, z 100, background ink, colour paper, `translateY(-100%)`→`none` .55s `cubic-bezier(.2,.7,.2,1)`, box-shadow `0 1px 0 rgba(241,239,229,.3)`. `.sm-in` 1280 wrap with bottom padding `clamp(28px,3.5vw,48px)`. `.sm-top` like `.top` with a paper hairline. `.sm-nav a` grid `48px 1fr auto`, gap 16, padding-block `clamp(14px,1.8vw,22px)`, size `clamp(30px,3.6vw,54px)`/300/-.03em, staggered in at .12/.18/.24/.30s; hover padding-left 12; `.on .m-t` underlined; `.m-n` 12px/.24em/400; arrow svg 22px fades in on hover. `.sm-foot` caps, flex space-between, padding-top 18. `.menu-close` caps button.
- `.foot` grid `1.4fr 1fr 1fr 1.6fr`, gap 40; 2 columns ≤900, 1 column ≤560. Footer: white, padding `clamp(28px,3vw,44px) clamp(20px,4vw,56px) 28px`, column gap `clamp(28px,3.5vw,48px)`, a top rule; caps links at 600; newsletter = caps label + underlined input row (16px/300) + "Join ↗" button; bottom row caps 400 with a top rule.
- Script: open/close toggles `.open` and `aria-expanded`, Escape closes, outside click closes, `#` links close. No focus trap or scroll lock (we keep ours).
- Variants: `homepage-data` `.strip-hdr` is absolute over the panels with paper colour and `clamp(20px,3vw,40px) clamp(20px,4vw,56px)` padding. `flavor-b` `.over` is absolute, z 5, with paper links.

### 0.3 Fonts

`fonts.css` self-hosts Lato: Light (100–300), Regular (400), **Medium file for 500–600**, Bold (700–800), Black (900). All four weights the handoff uses (300/400/600/700) resolve to a real file. 600 renders with Lato Medium, not Lato Semibold, which is slightly lighter than the Google Fonts 600 the handoff previews were drawn with. No Google Fonts tag was added.

### 0.4 Newsletter, legal routes, contact

- `subscribeNewsletter({ email, firstName?, source, … })` → `POST /api/newsletter/subscribe` (`api.ts:214`). The backend does not reject unknown sources; it looks the name up in `subscriber_source` and stores NULL if it is missing. **`footer` is already seeded** (`schema.sql:1002`, label "Footer Widget"; it is in the `comments.sql` too), so there is no backend change.
- `/privacy` and `/terms` exist (`App.tsx:213-214`) and are open under prelaunch.
- Contact: `hello@axisandbloomcoffee.com` (the `mailto:` in `Privacy.tsx:107`, `Terms.tsx:108`).
- **Instagram: deviation.** `SHORTLINKS['/ig']` is `/find-my-flavor?campaign=instagram&utm_source=instagram…`. That is our own quiz with Instagram campaign attribution, not the Instagram profile. A footer link there would count every footer click as Instagram campaign traffic. The site's actual Instagram profile is `https://instagram.com/axisandbloom` (the quiz-complete email template, `quizCompleteEmail.ts:252`). The footer links the profile. This is not a STOP: the intent ("Instagram" in the footer) is unchanged, and only the target is corrected.
- `/faq` does not exist, so the FAQ link is omitted.

### 0.5 Old hex values (file: count), before this brief

`#9a2918` (31 files): About 20 · TheAxisV1 18 · FlavorIntelligencePage 17 · Home 14 · FlavorQuiz 12 · TasteFinderSection 11 · BloomDial 10 · Shop 8 · FloatingCart 7 · CrawlLanding 7 · Footer 6 · CartLines 5 · DimensionBars 4 · OtherCategoryCard 4 · useCompatibility 3 · Navigation 3 · DoorBand 2 · CompareOverlay 2 · PreLaunch 2 · BloomPage 2 · portal.css 1 · TastingNotes 1 · CollaborativeFlavorWheel 1 · CheckoutReturnPage 1 · fillEngine 1 · archetypeConfig 1 · RevealedPanel 1 · TheAxis 1 · Terms 1 · ShareMatchRow 1 · Privacy 1.

`#a33726` (29): Profile 91 · SubscriptionPanel 34 · SignIn 31 · FamilyTab 28 · BrewProfileMirror 23 · CheckoutPage 22 · JoinHousehold 20 · FlavorQuiz 19 · ActivityTimeline 16 · TastingJournal 14 · OrderFeedbackForm 14 · AddressForm 11 · CheckoutReturnPage 11 · TheAxisV1 11 · NewsletterModal 8 · CompanyGiftRedemption 8 · AdminRoasteryPortal 7 · BrewCards 6 · WorthExploring 4 · AdminQrDoor 4 · ErrorBoundary 2 · theme.css 1 · AdminCalibrationWorkbench 1 · Sommelier 1 · RequireAuth 1 · QrDoor 1 · PostQuizEmailGate 1 · ConsentBanner 1 · CoffeeStoryPage 1.

`#f2f1ea` (39): FlavorQuiz 20 · Home 17 · About 7 · Shop 5 · HowItWorks 5 · portal.css 4 · TastingNotes 4 · TheAxisV1 4 · TasteFinderSection 4 · Navigation 4 · DimensionBars 3 · BloomDial 3 · TheAxis 3 · PreLaunch 3 · FloatingCart 2 · AdminRoasteryPortal 2 · Terms 2 · Profile 2 · NewsletterModal 2 · ErrorBoundary 2 · CrawlLanding 2 · BloomPage 2 · theme.css 1 · RoasteryPortal 1 · CollaborativeFlavorWheel 1 · CheckoutReturnPage 1 · CheckoutPage 1 · archetypeConfig 1 · DoorBand 1 · CartLines 1 · AxisMap 1 · SignIn 1 · RequireAuth 1 · Privacy 1 · PostQuizEmailGate 1 · JoinHousehold 1 · Footer 1 · FlavorIntelligencePage 1 · ConsentBanner 1.

`#f0ebe1`: 0 files.

Almost all of these are inline literals, not Tailwind theme classes. Remapping `--color-terracotta-dark` / `--color-beige-light` in `theme.css` (D1) therefore shifts only the `*-terracotta-dark` / `*-beige-light` utility users. The inline literals change when each page's brief swaps them.

### 0.6 `/cart`

There is no `/cart` route (`App.tsx`), as the brief expected. `CART_PAGE_ROUTE_EXISTS = false`.

### 0.7 Test tooling (not in the brief's assumptions; not a contradiction)

The frontend has no test runner: no vitest, no testing-library, no jsdom, and no `test` script. Part D's component tests need one, so this brief adds dev-only `vitest`, `@testing-library/react`, `@testing-library/dom` and `jsdom` to `frontend/`, plus `npm test`. CI's audit gate uses `--omit=dev`, so production deps are unchanged. CI does not run frontend tests today, and wiring them into `deploy.yml` is left in `OPEN_TASKS.md`.

### Verdict

Nothing contradicts the brief's goal or decisions, so Part A goes ahead. Deviations taken: the Instagram target (0.4) and the frontend test tooling (0.7).

## What was built

- **Tokens (Part A):** `styles/theme.css` adds `--ab-ink #ba4c38`, `--ab-paper #f1efe5`, `--ab-page #fff`, `--ab-ink-hairline`, `--ab-paper-hairline`, `--ab-mark-a/b`, `--ab-caps .24em`, `--ab-wrap 1280px`, `--ab-gutter 20px`, and `--ab-header-h` (the static header's height). Tailwind's `--color-terracotta-dark` / `--color-beige-light` now point at ink / paper (D1), and `--color-ab-ink/paper/page` are added. The family colours are unchanged.
- **Primitives (Part A):** `frontend/src/app/components/chrome/`: `Wrap`, `Caps`, `Titled`, `Btn` (`to` / `href` / button, `tone`, arrow slot), `Frame` (`ratio`, caption), `ArrowIcon`, `MarkSvg` / `MarkLockup` (`Mark.tsx`). The CSS is ported from the handoff into `chrome.css` under the `ab-` prefix.
- **Header and Menu overlay (Part B):** `Navigation.tsx`, as summarised in `WHAT_WE_BUILT.md` #251. `MENU_ITEMS`, `GATED_LINKS` and `CART_PAGE_ROUTE_EXISTS = false` are all in that file.
- **Footer (Part C):** `Footer.tsx`, as in #251. `PublicLayout.tsx` is unchanged apart from fixing the stale comment: same no-footer list, same curtain, `NewsletterModal` and `FloatingCart` still mounted.
- **Tests (Part D):** `chrome/chrome.test.tsx`, 13 cases:
  - Sign in signed out (and for anonymous guests); Profile/Sign out signed in.
  - Admin for admins only.
  - `Cart (3)` plus the drawer toggle.
  - While gated: nothing cart-related, no Admin, menu = Find my flavor.
  - Four items with `aria-current`.
  - Overlay: open, trap focus (both directions), Escape closes, focus returns, scroll lock released; outside-click and Close close it.
  - Footer: posts `{ email, source: 'footer' }` with the success line, inline error, current year, legal links, Liam gating, gated footer.

## Deviations from the brief, and why

1. **Instagram target.** The footer links the profile (`https://instagram.com/axisandbloom`), not `SHORTLINKS['/ig']`, which carries Instagram campaign attribution (Task 0.4).
2. **Flavor Intelligence kept in the footer.** The brief's column 2 list leaves it out, but the old footer had it and the brief says no link may be dropped. It is hidden while gated, as before. It left the header menu per D2.
3. **The drawer glyph button only renders once `/cart` exists.** While `CART_PAGE_ROUTE_EXISTS = false`, `Cart (n)` is itself the drawer toggle, and a second identical control beside it would be a duplicate for screen readers. When Website 8 flips the constant, the glyph appears beside the count automatically.
4. **Below 480px, Admin moves into the overlay foot row** along with Sign in / Profile · Sign out. At 390px, `Profile · Sign out · Cart · Admin · Menu` does not fit on one line.
5. **Two small layout offsets in page files.** These are not redesigns: the old fixed 46px bar is gone, so two hard-coded offsets would otherwise show a gap or overlap. `BloomPage.tsx` jump-nav `sticky top` 64 → 0. `Sommelier.tsx` chat panel `top` 64 → `var(--ab-header-h)`.
6. **Frontend test tooling** (Task 0.7): dev-only `vitest`, `@testing-library/react`, `@testing-library/dom`, `jsdom`, plus `npm test` in `frontend/`.
7. **`re2js` 2.8.6 → 2.9.1** in `frontend/package-lock.json` (transitive, via firebase → @firebase/firestore). A high advisory (GHSA-gg6h-894w-4m9c) made `npm audit --omit=dev --audit-level=high` fail on `main` itself after today's 15:01 deploy, and that gate would have blocked this push. The fix was `npm audit fix` without `--force`; it touches only the lockfile, and CI runs Node 22, which satisfies re2js's `>=20`.
8. **Copy:** the footer bottom line follows the brief ("Coffee matched to your personal flavor."), not the handoff's "Coffee, personalized." The overlay foot row keeps "Coffee, personalized." as drawn. No copy in this brief names what we are not doing (G4.4).

## Things noticed, not changed

- `/find-my-flavor` is outside `PublicLayout` (`App.tsx:146`), so the quiz has never shown the global nav and still does not. Its paper-tone header is Website 7A's job; `Navigation` already takes `tone="paper"`.
- Home at 390px has a 2px horizontal overflow from page divs (hero/collection), not from the chrome. To check in Website 3.
- With the static header the bar scrolls away with the page, as the handoff draws it. The old bar was fixed. This is a visible behaviour change, and it is the design.
- `PublicLayout`'s old comment claimed Home/About render a footer inside `TasteFinderSection`. They do not; corrected.

## Needs a design

- FAQ page (OT-66).
- A signed-in "Profile" treatment for the header: today it is the same caps text link as the handoff's "Sign in".

## Acceptance evidence (local, before push)

Vite dev server on :5179 with `/api` proxied to prod. Coffee data failing to load in that local proxy setup is expected, and only the chrome was under test. Headless Chromium (Playwright), signed out, `?preview=true`, at 390 and 1280:

| Route | Header (1280 / 390) | Fits | Footer |
|---|---|---|---|
| `/` | floating paper over the hero, 94 / 62px; at 390 "Cart (0) · Menu" | yes | none (no-footer route, unchanged) |
| `/bloom`, `/the-axis`, `/shop`, `/sign-in`, `/privacy` | ink, static, "Sign in · Cart (0) · Menu" (390: "Cart (0) · Menu") | yes, no horizontal scroll | new footer |
| `/profile`, `/checkout` | signed out → redirected to `/sign-in` (RequireAuth, unchanged) | yes | new footer |
| `/find-my-flavor` | no global nav (own chrome, unchanged) | n/a | n/a |

**Keyboard walk** (both widths), from the page: Tab to `Menu` → Enter opens it. Focus order is mark → Close → 01 Shop all → 02 The Axis → 03 The Bloom → 04 Find my flavor → Sign in → Cart (0) → mark (wraps). Escape closes it, focus is back on `Menu`, `aria-expanded="false"`, and body overflow is restored. `/the-axis` is marked current (underlined, `aria-current="page"`).

Unit tests 13/13. Frontend `tsc` has 10 errors, all pre-existing in untouched files (Home 1, Profile 3, TheAxis 2, bloom/ArchetypeSection 1, bloom/useAdjacentArchetype 3); the #250 baseline was 13. `vite build` is green, and `npm audit --omit=dev --audit-level=high` passes.

## Push, deploy, smoke (production)

- Commit `19130f0`, pushed to `main`. Deploy run `41952553039` succeeded: backend and frontend jobs green, and the frontend `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities.
- Backend revision `axis-bloom-backend-00815-gfj` (no backend change; redeployed by the workflow). The startup log has no ERROR lines. `[data-catalog] report only: 152 tables, 76 views, 1391 columns; 1 of 6 checks with findings` (dead-table candidates). The other integrity lines are the standing ones: sommelier #3 "oz" (OT-37), quiz #10, evidence #2/#6.
- **Smoke.** Headless runs against production get Cloudflare's bot challenge, which was not bypassed. The smoke therefore ran in Dana's Chrome (signed in as admin) at desktop width, read through the DOM:
  - `/the-axis?preview=true`: header "Axis & Bloom | Profile | Sign out | Cart (0) | Admin | Menu", 94px. Menu `/shop, /the-axis (aria-current), /bloom, /find-my-flavor`.
  - Footer "The Axis | The Bloom Dial | Liam | Find My Flavor | Flavor Intelligence | Cart | Instagram | Contact | newsletter | © 2026 … | Terms · Privacy". Liam shows because this account has access.
  - Menu overlay live: open → `aria-expanded=true`, focus inside, body overflow hidden, foot row "Profile · Sign out · Cart (0) · Admin · Coffee, personalized.". Escape → closed, `aria-expanded=false`, overflow restored, focus on Menu.
  - `/sommelier`: chat panel top 94 = header bottom 94 (no overlap). No footer (Liam chat, unchanged).
  - `/bloom`: after scrolling 1000px the jump-nav sticks at top 0.
  - `/profile`: header bottom 94, first content ("Your flavor memory.") at 253, new footer.
  - `/checkout` with an empty cart redirects to `/bloom` (existing behaviour); header and footer are the new ones.
  - **Gated** (preview flag cleared, `/privacy`): header "Profile | Sign out | Menu" with no cart and no Admin, menu `/find-my-flavor` only, footer nav "Find My Flavor" only, no floating cart. The preview flag was restored afterwards.
- 390px: verified locally (headless; table above). Phone-width production was not re-checked, because the Chrome window did not resize below its DPI-scaled width.
- Screenshots: local headless captures were saved during the run (session scratchpad, not committed). The extension's screenshot capture was unreliable on this machine (timeouts and "chrome-extension://" errors), so production evidence is DOM measurement, as above.

## What the next brief needs

- **Website 2** (presentation data) does not depend on this brief's code.
- **Website 3–7** use `Wrap / Caps / Titled / Btn / Frame / ArrowIcon / MarkSvg` from `components/chrome` and the `--ab-*` tokens.
  - Pass `<Navigation tone="paper" />` or `floating` by route when a page needs it. For example, Home drops `data-hero` in brief 3 and PublicLayout decides the variant.
  - Swap the page's inline hex literals (list in 0.5).
- **Website 8** flips `CART_PAGE_ROUTE_EXISTS` in `Navigation.tsx` when `/cart` lands. Header and footer then link to `/cart`, and the drawer glyph appears.
- **7A** decides whether the quiz route moves under `PublicLayout` or keeps its own chrome.
