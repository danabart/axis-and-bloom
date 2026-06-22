# Camila's Updates — Axis & Bloom

A record of all frontend changes made from June 2026 onward, following the same format as WHAT_WE_BUILT.md.

All changes are deployed automatically via GitHub Actions on every push to `main`.  
Live site: https://axisandbloom.com  

---

## How to Deploy

Any change pushed to `main` triggers the CI/CD pipeline automatically — no manual steps needed.

To push changes:
```
cd /Users/camilamarchon/axis-and-bloom
git add <file>
git commit -m "description of change"
git push origin main
```

To bypass the pre-launch page and see the full site:
```
axisandbloom.com/?preview=true
```
This persists for the whole browser session.

To turn off the pre-launch page permanently when ready to launch:
- Open `.github/workflows/deploy.yml`
- Remove or set to `false`: `VITE_PRELAUNCH_MODE: 'true'`
- Push to main

---

## How to Activate Mailchimp

Signups currently save to the database only. To also sync them to your Mailchimp audience, follow these steps:

### Step 1 — Get your Mailchimp credentials
1. Log in to Mailchimp
2. **API key**: go to Account → Extras → API keys → Create A Key
3. **List ID**: go to Audience → All contacts → Settings → Audience name and defaults → Audience ID

### Step 2 — Add secrets to GCP Secret Manager
Go to [GCP Secret Manager](https://console.cloud.google.com/security/secret-manager?project=axis-and-bloom-prod) and create two new secrets:

| Secret name | Value |
|---|---|
| `MAILCHIMP_API_KEY` | Your Mailchimp API key (e.g. `abc123-us21`) |
| `MAILCHIMP_LIST_ID` | Your Mailchimp audience ID |

For each: click **Create secret** → enter the name → paste the value → click **Create secret**.

### Step 3 — Add secrets to the Cloud Run deploy command
Open `.github/workflows/deploy.yml` and find the `--set-secrets` line in the `Deploy to Cloud Run` step. Add the two Mailchimp entries at the end:

```
...,RESEND_API_KEY=RESEND_API_KEY:latest,MAILCHIMP_API_KEY=MAILCHIMP_API_KEY:latest,MAILCHIMP_LIST_ID=MAILCHIMP_LIST_ID:latest"
```

### Step 4 — Push to deploy
```
git add .github/workflows/deploy.yml
git commit -m "feat: activate Mailchimp integration"
git push origin main
```

Once deployed, every new signup from the pre-launch form will be added to your Mailchimp audience with their first name as `FNAME`. Existing DB signups are not back-filled automatically.

---

## Changes Log

### 1. Hero — replaced A&B with COMING SOON
**File:** `frontend/src/app/components/Home.tsx`

Replaced the `A&B` text in the left half of the homepage hero with a typographic COMING SOON treatment:
- "COMING" in Genova Thin, wide letter spacing (`0.38em`), responsive size (`clamp(2.5rem, 7.5vw, 8.5rem)`)
- A 1px horizontal rule between the two words (color `#a33726`, 30% opacity)
- "SOON" in Genova Regular, large display size (`clamp(6rem, 17vw, 19rem)`), tight tracking
- Both words centered within the left half of the split screen

---

### 2. Font — applied Genova across the entire website
**Files:** `frontend/src/styles/fonts.css`, `frontend/src/styles/theme.css`, all component files

The Genova font family was already referenced in several components but was never declared — so the browser was falling back to the system font. Fixed by:

- Added `@font-face` declarations in `fonts.css` for all four non-italic weights:

| Weight | File |
|---|---|
| 100 — Thin | `Genova-Thin.otf` |
| 400 — Regular | `Genova.otf` |
| 500 — Medium | `Genova-Medium.otf` |
| 900 — Black | `Genova-Black.otf` |

- Set `font-family: 'Genova', sans-serif` globally on `body` in `theme.css`
- Removed all scattered inline `fontFamily` style props from every component (Shop, Footer, Profile, SignIn, FlavorQuiz, NewsletterModal, Home, About)
- Fixed `Home.tsx` and `About.tsx` which were referencing `'Geneva, sans-serif'` (the macOS system font) instead of `'Genova'`
- Font files live at: `frontend/src/design/FONT/genova/`

**Italic is blocked globally** via `* { font-style: normal !important; }` in `fonts.css`.

---

### 3. Font weights — removed all bold, site uses only Regular and Thin
**Files:** All component files, `frontend/src/styles/theme.css`

Replaced every instance of `font-bold`, `font-semibold`, `font-medium`, `font-black`, and `font-extrabold` with `font-normal` across all components (public and admin). Also updated `--font-weight-medium: 500` → `400` in `theme.css` so headings (h1–h4), labels, and buttons all default to regular weight.

The only two weights in use across the site are:
- `font-thin` → Genova Thin (100)
- `font-normal` → Genova Regular (400)

---

### 4. Hero — centered COMING SOON within the left half
**File:** `frontend/src/app/components/Home.tsx`

Changed the COMING SOON block from left-aligned (`justify-start`, `items-start`) to centered (`justify-center`, `items-center`, `text-center`) within the left panel of the split screen.

---

### 5. Pre-launch curtain page
**Files:** `frontend/src/app/components/PreLaunch.tsx` (new), `frontend/src/app/App.tsx`, `.github/workflows/deploy.yml`

Created a full-screen pre-launch page that shows at `axisandbloom.com/` while the site is in pre-launch mode. All other routes (`/about`, `/shop`, `/admin`, etc.) remain fully accessible.

**Layout — split screen:**
- Left half (`#f0ebe1`): `LogoLines.svg` from `src/design/LOGO/`, centered, max-width 280px
- Dividing line: `1px solid #a3372620`
- Right half (`#f0ebe1`): centered column with:
  1. Tagline — Genova Regular, `1.1rem`, `#a33726`, `letter-spacing: 0.05em`, uppercase: `YOUR COFFEE IDENTITY. COMING SEPTEMBER 1.`
  2. Thin separator line — `1px solid #a3372630`
  3. First name input — border-bottom only, transparent background, Genova `0.9rem`, placeholder `your first name`
  4. Email input — same styling, placeholder `your email`
  5. `JOIN →` button — no background, no border, Genova Regular, `0.85rem`, hover opacity `0.6`

**Mobile:** stacks vertically — logo on top half, content on bottom half (breakpoint: 768px).

**Form submission:** POSTs `{ email, firstName, source: 'pre_launch' }` to `/api/newsletter/subscribe`. On success, shows "You're on the list."

**Controlled via environment variable:**

| Variable | Value | Effect |
|---|---|---|
| `VITE_PRELAUNCH_MODE` | `'true'` | Pre-launch page active |
| `VITE_PRELAUNCH_MODE` | `'false'` or missing | Normal site |

Set in `.github/workflows/deploy.yml` under the `Install & build frontend` step.

---

### 6. Pre-launch bypass via URL
**File:** `frontend/src/app/App.tsx`

Added a secret preview bypass so the team can access the full site while the pre-launch page is live for the public.

**How it works:**
- Visit `axisandbloom.com/?preview=true`
- The bypass is stored in `sessionStorage` — stays active for the whole browser session
- Close and reopen the browser to reset (pre-launch shows again)

**Implementation:** A `HomeOrPrelaunch` component inside the router uses React Router's `useSearchParams` hook to read the `preview` param. If present (or previously stored in sessionStorage), it renders `<Home />` instead of `<PreLaunch />`.

---

### 7. Newsletter — first name field + Mailchimp integration
**Files:** `backend/src/routes/newsletter.ts`, `backend/src/db/schema.sql`

Updated the newsletter subscribe endpoint to accept and store a first name, and forward it to Mailchimp.

**Database:**
- Added `first_name TEXT` column to `newsletter_subscriber` table (idempotent `ADD COLUMN IF NOT EXISTS` migration)
- `subscriber_source` table added by Dana in the same sprint — tracks where each signup came from (`pre_launch`, `newsletter`, `post_quiz`, `footer`)

**Backend route (`/api/newsletter/subscribe` and backward-compat `/api/newsletter`):**
- Accepts `{ email, firstName?, source? }` — `source` defaults to `'newsletter'`
- Stores `first_name` and `source_id` in the DB
- Forwards to Mailchimp via the Marketing API (`PUT /lists/{list_id}/members/{email_hash}`) with `FNAME` merge field
- Mailchimp call is non-blocking — if it fails, the signup still completes
- Mailchimp is skipped entirely when credentials are not configured (`MC_ENABLED = false`)

**To activate Mailchimp**, add two secrets to GCP Secret Manager then add them to `--set-secrets` in `deploy.yml`:

| Secret name | What it is |
|---|---|
| `MAILCHIMP_API_KEY` | Mailchimp API key (format: `key-us21`) |
| `MAILCHIMP_LIST_ID` | Mailchimp audience / list ID |

---

### 8. Fix — backend deployment failure after Mailchimp secrets were added
**File:** `.github/workflows/deploy.yml`

Cloud Run's `--set-secrets` flag fails the entire deployment if any referenced secret does not exist in GCP Secret Manager. Adding `MAILCHIMP_API_KEY` and `MAILCHIMP_LIST_ID` to `--set-secrets` before creating them in Secret Manager caused the backend deploy to fail.

**Fix:** Removed the two Mailchimp entries from `--set-secrets`. The newsletter code handles missing env vars gracefully. Re-add them to `--set-secrets` once the secrets are created in GCP.

---

### 9. PreLaunch visual redesign — final state
**File:** `frontend/src/app/components/PreLaunch.tsx`

Iterated through several visual versions of the pre-launch page. Current final state:

**Left half:**
- Background: `#f2f1ea`
- `LogoLines.svg` imported as a plain `<img>` tag — original terracotta, pink, and gray stroke colors fully preserved, no CSS filter
- Logo width: 480px, capped at `min(480px, 85vw)` for responsive scaling

**Right half:**
- Background: `#deded1`
- Content centered with 80px padding on desktop, 40px on mobile
- Tagline: Genova Regular, `1rem`, `#a33726`, `letter-spacing: 0.12em`, `line-height: 1.8`, split across two lines
- Thin separator: `1px solid #a3372640`, 32px margin above and below
- First name input + email input: `1.5px` border-bottom, `1rem`, `32px` gap between fields
- `JOIN →` button: `0.95rem`, `letter-spacing: 0.15em`
- Placeholder text styled via `::placeholder` CSS rule at 45% opacity in Genova

**Dividing line:** `1px solid #a3372620`

---

### 10. Fix — frontend build failure (missing LOGO assets)
**File:** `frontend/src/design/LOGO/` (6 SVG files added to git)

`PreLaunch.tsx` imports `LogoLines.svg` from `src/design/LOGO/`. The folder existed locally but was never committed to git. CI clones the repo fresh, so the import resolved to a missing file and the Vite build failed with a module not found error.

**Fix:** Staged and committed all 6 logo files (`LogoLines.svg`, `LogoCircle.svg`, `LogoQuarter1–4.svg`).

---

### 11. Fix — PreLaunch mobile layout (logo clipping)
**File:** `frontend/src/app/components/PreLaunch.tsx`

On screens below 768px the logo was being clipped. Four mobile-specific fixes applied:

| Fix | Before | After |
|---|---|---|
| Top panel height | `h-2/5` (40%) | `h-[45vh]` |
| Bottom panel height | `h-3/5` (60%) | `h-[55vh]` |
| Logo max-width | `85%` of container | `min(480px, 85vw)` |
| Panel padding (mobile) | none | `p-6` (24px all sides) via Tailwind responsive |
| Overflow | not set | `overflow: hidden` |

Desktop layout (50/50 split, 80px padding, 480px logo) is completely unchanged.

---

### 12. Act 1 hero — beans photo left panel, removed COMING SOON, logo watermark
**File:** `frontend/src/app/components/Home.tsx`

Replaced the plain `#f2f1ea` background on the left hero panel with a full-bleed product photo and a watermark logo overlay. Removed the COMING SOON typographic treatment entirely.

**Left panel (background layer):**
- `motion.div` wrapper: `position: relative`, `overflow: hidden` (replaces `backgroundColor: '#f2f1ea'`)
- Full-bleed `<img>` of `A_B03.png`: `position: absolute`, `inset: 0`, `width/height: 100%`, `objectFit: cover`
- Logo watermark: `LogoQuarter1.svg`, `position: absolute`, `top: 40px`, `left: 40px`, `60×60px`, CSS filter `brightness(0) invert(1) sepia(1) saturate(0) brightness(2)` renders it in cream

**Removed:** The `motion.div` with `initial={{ opacity: 0, scale: 0.8 }}` that contained "COMING" / horizontal rule / "SOON" — deleted entirely from the z-10 overlay layer.

**New imports added:**
```ts
import beansPhoto from '../../design/IMAGES/A_B03.png'
import chaffPhoto from '../../design/IMAGES/A_B06.png'  // reserved for TasteFinderSection
```

---

### 13. Assets — added A_B03 and A_B06 product photos
**Files:** `frontend/src/design/IMAGES/A_B03.png`, `frontend/src/design/IMAGES/A_B06.png`

Committed two product photo assets to the repo. Files were originally named `A&B03.png` / `A&B06.png` (ampersands) and renamed to underscores to match the import paths in `Home.tsx` and to avoid shell escaping issues. Directory casing also corrected from `images` → `IMAGES` to match the on-disk folder name and avoid Linux case-sensitive build failures.

---

### 14. Navbar — logo mark + Genova font on all nav text
**File:** `frontend/src/app/components/Navigation.tsx`

Updated the left side of the navbar from a plain text wordmark to a logo + text lockup, and applied Genova to all right-side nav links.

**Left side (logo lockup):**
- `LogoQuarter1.svg` imported and rendered as `<img>` at `28×28px`
- Wordmark `<span>`: Genova Regular, `#b05642`, `0.75rem`, `letter-spacing: 0.15em`
- Removed `hover:opacity-60 transition-opacity` from the wrapper link

**Right side:**
- Added `fontFamily: 'Genova, sans-serif'` to the container `<div>` so it cascades to all nav links (How it works, Find my flavor, About, Shop, Admin, Sign in)

---

### 15. Fix — hero headline anchored to right panel
**File:** `frontend/src/app/components/Home.tsx`

The hero text `motion.div` (headline + CTAs) was positioned in normal flow, occupying the left half of the overlay layer now that COMING SOON was removed. Fixed by making it absolutely positioned and pinning it to the right half.

- `className`: added `absolute right-0`, removed implicit left-flow positioning
- `style`: added `top: 0, bottom: 0` to fill the full height of the hero
- Starting vertical position: `pt-48` (changed from original `pt-32` to lower the headline)

---

### 16. Brand color tokens — Tailwind v4 @theme
**File:** `frontend/src/styles/theme.css`

Added 12 named brand color tokens to the `@theme inline` block so Tailwind utility classes (`text-terracotta-dark`, `bg-beige-light`, etc.) become available across the codebase. No existing component code was changed — only the token definitions were added.

| Token | Hex | Role |
|---|---|---|
| `--color-terracotta-dark` | `#a33726` | Primary UI text + CTAs |
| `--color-terracotta-mid` | `#b15643` | Section 2 headings |
| `--color-terracotta-line` | `#ba3d24` | LogoLines stroke color |
| `--color-terracotta-fill` | `#a8462c` | LogoCircle fill color |
| `--color-pink` | `#ee5974` | Highlight + hover states |
| `--color-pink-logo` | `#ca526d` | Logo SVG pink paths |
| `--color-gray-logo` | `#858585` | Logo SVG gray paths |
| `--color-beige-light` | `#f2f1ea` | Page bg, inputs |
| `--color-beige-mid` | `#deded1` | Right hero bg, section bg |
| `--color-beige-dark` | `#e5e5da` | Wrapper bg |
| `--color-sand` | `#ddc1a6` | LogoCircle warm beige paths |
| `--color-cream` | `#ead8bf` | LogoLines cream stroke |

---

### 17. Hero left panel — logo bloom animation (safe opacity/scale)
**File:** `frontend/src/app/components/Home.tsx`

Replaced the hero left panel (previously a full-bleed photo + watermark) with a centered logo bloom animation on a solid `#ebebe3` background. Uses only `opacity` and `scale` — no `pathLength` (which crashed in Motion v12).

**Animation sequence:**
1. Left panel slides in over 1.2s (existing entrance)
2. At 1.2s: `LogoLines.svg` fades in over 0.8s
3. Rests for 1s (fully visible at ~2.0s)
4. At 3.0s: cross-fade — LogoLines fades out, LogoCircle fades in with scale 0.96→1.0, both over 0.9s
5. End state: full-color `LogoCircle.svg` resting centered

**Implementation:**
- Two states: `linesVisible` (set at 1200ms) and `showCircle` (set at 3000ms)
- Stacked layout: `position: relative` container at 60% width; LogoCircle absolutely positioned beneath; LogoLines in flow on top
- Both SVGs imported as Vite assets (`import logoLines/logoCircle from '../../design/LOGO/...'`)

**Removed:** `beansPhoto`, `logoQuarter1` imports; `logoContainerVariants`, `logoPathVariants`, `CROSSFADE_DELAY_MS` constants; all `motion.path` pathLength animation code.

---

### 18. Full image library committed + image directory reorganised
**Files:** `frontend/src/design/IMAGES/` (35 files added)

Committed the full design asset library to the repo, organised into subfolders:

| Folder | Contents |
|---|---|
| `archetypes/` | 6 archetype JPGs (Balanced-&-Sweet, Chocolate-&-Nutty, Experimental, Floral, Fruity, Spicy-&-Earthy) |
| `bags/` | TransparentBag01–03.png |
| `elements/` | 4 SVG design elements (Bars, axis1–3) |
| `lifestyle/` | CoffeePic01–17 (.png and .jpg) |
| `patterns/` | 3 SVG pattern files |
| `references/` | colorpalette.png |

---

### 19. Manifesto strip — replaced ticker section
**File:** `frontend/src/app/components/Home.tsx`

Replaced the entire pink ticker/marquee + "Whose palate are we profiling today?" taste finder form block with a full-width typographic strip.

**Design:**
- Background: `#a94936` (terracotta-80)
- Padding: 120px top and bottom
- Max-width: 800px, centered
- Line 1: `clamp(2rem, 4vw, 3.5rem)`, weight 300, `#f2f1ea`, line-height 1.2
- Line 2: `clamp(1rem, 1.8vw, 1.25rem)`, weight 300, `#f2f1ea` at 80% opacity, letter-spacing 0.08em
- Entrance: `whileInView` on each `motion.p` — opacity 0→1, y 30→0, 0.9s ease `[0.16, 1, 0.3, 1]`; Line 2 delayed 0.25s

**Removed along with the section:** `handleProfileStart` function, `useNavigate` hook and import (all now dead code).

---

### 20. Archetype grid section — replaced "Where taste becomes a match"
**File:** `frontend/src/app/components/Home.tsx`

Replaced the full-screen "Where taste becomes a match" split section with a full-width archetype card grid.

**Section header (centered, above grid):**
- Label: "THE SIX ARCHETYPES" — `0.75rem`, `letter-spacing: 0.2em`, weight 400, `#a94936`
- Heading: "Which world feels like yours?" — `clamp(1.8rem, 3vw, 2.8rem)`, weight 300, `#9a2918`

**Grid layout:** 3 columns desktop / 2 tablet / 1 mobile, no gap (cards sit flush), full viewport width (no max-width, no horizontal padding on the grid container). Background: `#ebebe3`.

**Card design:** Flat solid background per archetype (no texture or image overlay), `min-height: 460px`, `padding: 2.5rem`. All card text uses `fontFamily: "'Genova', sans-serif"` and `fontWeight: 100` (Genova Thin) throughout.

**Six archetypes:**
| # | Name | Background |
|---|---|---|
| 01 | Floral | `#a34b78` |
| 02 | Fruity | `#ca445f` |
| 03 | Balanced & Sweet | `#d1ac11` |
| 04 | Chocolate & Nutty | `#a54c2d` |
| 05 | Spicy & Earthy | `#912f2f` |
| 06 | Experimental | `#056c7a` |

**Entrance animation:** `whileInView` on the grid container — opacity 0→1, y 40→0, 0.8s. Cards have `whileHover={{ scale: 1.02 }}` over 0.3s.

**Note on bundle size:** The project's `vite.config.ts` has a custom `inlineRasterImages` plugin that base64-encodes all `.png`/`.jpg` imports into the JS bundle. The 6 archetype JPG imports push the bundle to ~10 MB. Images are kept imported for future use; this should be resolved by moving images to `public/` or disabling the plugin for large assets.

---

### 21. Manifesto strip — left-aligned layout, removed subline, added text CTA
**File:** `frontend/src/app/components/Home.tsx`

Redesigned the terracotta manifesto band (below the split hero, above the archetype grid).

**Layout changes:**
- Text block changed from center-aligned to **left-aligned**
- Left inset uses `paddingLeft: clamp(24px, 8vw, 120px)` — scales from mobile gutter to ~120px on wide screens
- Text constrained to `maxWidth: 600px`; right two-thirds of the band is intentionally empty
- Vertical padding: `clamp(80px, 12vw, 160px)` top and bottom (responsive, scales down on mobile)

**Content changes:**
- Removed "A ritual mapped to your mood." entirely
- Headline ("You already know what you love...") kept; explicit `fontFamily: "'Genova', sans-serif"` added
- Added text CTA below headline with `marginTop: clamp(28px, 3vw, 40px)`:
  - Renders as: `Find your flavor →`
  - Links to `/find-my-flavor` (same route as the nav "Find my flavor" item)
  - Plain text, no background or border box
  - Underline on "Find your flavor" only (not the arrow): `1px`, `textUnderlineOffset: 3px`, faint `rgba(242,241,234,0.55)` at rest
  - Hover: underline strengthens to full `#f2f1ea`, opacity lifts to 1.0
  - Genova weight 300, `#f2f1ea`

---

### 22. Genova font enforcement — removed font-sans site-wide
**Files:** `FamilyTab.tsx`, `FlavorQuiz.tsx`, `JoinHousehold.tsx`, `Profile.tsx`, `SignIn.tsx`

Tailwind's `font-sans` utility explicitly sets the system font stack (`ui-sans-serif, system-ui, -apple-system...`), overriding the inherited Genova from `body`. Removed all 13 occurrences across 5 components so every element now inherits Genova correctly.

| File | Occurrences removed |
|---|---|
| `Profile.tsx` | 5 |
| `JoinHousehold.tsx` | 4 |
| `FamilyTab.tsx` | 2 |
| `FlavorQuiz.tsx` | 1 |
| `SignIn.tsx` | 1 |

---

### 23. Archetype cards replaced with CoffeePic16 bridge section
**File:** `frontend/src/app/components/Home.tsx`

Replaced the archetype card grid with a simple full-width image bridge section.

- Height: `60vh`
- Image: `CoffeePic16.jpg` (lifestyle), full-bleed cover, `objectPosition: 'center 25%'` (iterated: bottom → top → 25% to show the right crop)
- Single line of text overlaid bottom-left: *"There are six taste identities. One is made for you."*
- Text: Genova Regular (400), white, `22px` (`clamp(20px, 1.8vw, 22px)`), `padding: clamp(32px, 4vw, 56px)`
- Completely static — no animation, no hover, no overlay

Also removed: 6 archetype JPG imports and the `archetypes` data array (significant bundle size reduction).

---

### 24. Curtain section — chaff photo surface, coffee bag + quiz copy revealed
**File:** `frontend/src/app/components/TasteFinderSection.tsx`

Replaced content inside the existing scroll-driven curtain animation (animation mechanic unchanged).

**Curtain surface (moving layer):**
- `CoffeePic13.png` (lifestyle/chaff) as full-bleed cover image filling the entire curtain
- Headline ("Which archetype is yours?") kept exactly in place, riding with the curtain as before
- Text block backgrounds changed from solid `#f2f1ea` to `rgba(242,241,234,0.85)` for readability over the photo; pink "archetype" word retains solid `#ee5974` bg

**Revealed underneath:**
- Left: `TransparentBag03.png` — `objectFit: contain`, centered, `width: 120%`, `maxWidth: 640px` (doubled from original 320px)
- Right: quiz copy unchanged; link updated from `<Link to="/find-my-flavor">` → `<a href="https://axisandbloomcoffee.com/find-my-flavor">`
- `Link` import removed (no longer used)

---

### 25. Genova font audit — confirmed clean site-wide
**Files checked:** all `.tsx`, `.ts`, `.css` files in `frontend/src`

Full audit run after removing `font-sans`. Results:

- **Zero** remaining `font-sans`, `font-serif`, or `font-mono` Tailwind classes
- **Zero** `fontFamily` values pointing to any non-Genova font
- `AdminLayout.tsx` has `fontFamily: 'inherit'` — correct, inherits Genova from body
- Global body font (`'Genova', sans-serif`) set in `theme.css` cascades to all elements unless overridden
- All explicit `fontFamily` overrides in `Home.tsx`, `Navigation.tsx`, `PreLaunch.tsx`, `HowItWorks.tsx`, `CoffeesPage.tsx` all correctly reference `'Genova', sans-serif`

No code changes needed — site is fully on Genova.

---

### 26. Nav logo proportions + font-display fix
**Files:** `frontend/src/app/components/Navigation.tsx`, `frontend/src/styles/fonts.css`

**Logo proportions:**
- Mark: changed from `width: 28, height: 28` (squashed — viewBox is 139×155, aspect ratio 0.89) to `height: 20, width: auto` (preserves ratio, ~17.9px wide)
- Wordmark: increased from `0.75rem` (12px) to `20px` to optically match the mark height
- `letterSpacing` reduced from `0.15em` to `0.1em` (adjusted for larger size)
- `lineHeight: 1` added to prevent extra vertical space
- Gap: explicit `9px`

**font-display iteration:**
- Changed `swap` → `block` (to prevent Helvetica flash) — caused invisible text for up to 3s
- Reverted `block` → `swap` — text shows immediately in system fallback, then Genova swaps in when loaded. This is the correct balance.

---

### 27. Homepage full editorial redesign
**Files:** `Home.tsx`, `Navigation.tsx`, `Footer.tsx`

Complete homepage redesign for a cinematic, airy, editorial feel. Only the homepage, nav, and footer were changed. Quiz, shop, admin, and all other routes untouched.

**Navigation redesign:**
- Solid `#f2f1ea` background (was transparent/default), `64px` height
- `1px solid rgba(154,41,24,0.1)` border-bottom
- Logo lockup: 20px mark + 20px "AXIS & BLOOM" wordmark in Genova
- Middle links: How it works / Find my flavor / Our coffees / About / Shop (hidden on mobile via `hidden md:flex`)
- Removed: Admin link, `|` separator, text labels on right icons
- Right side: User icon + Cart icon only, pink dot badge on cart
- All Genova, terracotta `#9a2918` throughout

**Footer redesign:**
- Off-white `#f2f1ea`, editorial 3-column layout
- Left: Logo + "Coffee matched to your personal flavor" tagline
- Centre: Explore links (Find my flavor, Our coffees, Shop, How it works)
- Right: Company links (About, Contact, Instagram)
- Bottom bar: © 2026 + Privacy / Terms
- All Genova, terracotta/gray-beige text

**Homepage — 9 sections:**

| # | Section | Background | Notes |
|---|---|---|---|
| 1 | **Hero** | Dark video overlay | Full-screen video-ready component; current placeholder `imgur.com/HKuT8YR.mp4`; `poster={coffeePic16}`; bottom-left headline + 2 CTAs; bottom-weighted gradient |
| 2 | **Concept** | `#f2f1ea` | "You already know what you love…" quote + supporting copy; `whileInView` fade-up |
| 3 | **How It Works** | `#e5e5da` | 3-step numbered grid; stagger animation on scroll |
| 4 | **Profile Entry** | CoffeePic16 photo (`90vh`) | Right-side form overlay with gradient; "BEGIN PROFILE →" submits name and navigates to `/find-my-flavor` |
| 5 | **The Flavor Map** | `#f2f1ea` | 2-column: LogoCircle SVG left, text description right |
| 6 | **Cinematic** | Dark video overlay (`65vh`) | Second video-ready placeholder; caption bottom-left |
| 7 | **Coffee Collection** | `#f2f1ea` | 3 bag cards in `#e5e5da` tile containers; CTA to `/shop` |
| 8 | **Human + AI** | `#9a2918` terracotta | "Guided by AI. Curated by taste." centred copy |
| 9 | **TasteFinderSection** | Unchanged | Curtain scroll animation, unchanged |

Removed: logo bloom animation (was an intro-era sequence); all `font-sans` overrides; `chaffPhoto` unused import; `logoLines` from hero.

**Video-ready pattern** — both video sections built with:
```tsx
<video autoPlay loop muted playsInline poster={fallbackImage}>
  <source src="[URL — swap this for real video]" type="video/mp4" />
</video>
```

---

### 28. Genova font-display investigation and fix
**File:** `frontend/src/styles/fonts.css`

Full font audit run on request. Findings:

- **Font files:** `.otf` only — no `.woff2`/`.woff` exist. Files at `frontend/src/design/FONT/genova/`
- **`@font-face` declarations:** already correct in `fonts.css` with proper relative paths and `format('opentype')`
- **Build output:** all 4 weights confirmed bundled and fingerprinted in `dist/assets/` (e.g. `Genova-BhqGBCC4.otf`)
- **Root cause of "not loading" appearance:** `font-display: block` (set in entry 26) causes text to be invisible for up to 3 seconds while the font downloads — makes it look like the font isn't working
- **Fix:** restored `font-display: swap` on all 4 weights — text renders immediately in system fallback, then swaps to Genova once the `.otf` file loads

**To verify in DevTools:** Hard-refresh (`Cmd+Shift+R`) → wait ~1-2s → inspect any text → Computed tab → `font-family` should show `Genova` at top of resolved stack.

---

### 29. TasteFinderSection — vertical curtain lift, bag + text revealed underneath
**File:** `frontend/src/app/components/TasteFinderSection.tsx`

Redesigned the curtain reveal section at the bottom of the homepage. The scroll animation mechanic is preserved (200vh container + sticky viewport), but the curtain direction and revealed content were both changed.

**Problem with previous version:** The curtain slid horizontally (translateX). The chaff photo occupies the right 58% of the editorial stripe, centered vertically — the same vertical zone as the coffee bag in the revealed layer. As the stripe slid left, the chaff photo dragged across the bag, creating an awkward accidental overlap.

**Fix:** Changed the curtain slide direction to **vertical** (translateY 0 → -100%). The curtain lifts straight up out of the viewport; the bag is revealed cleanly from below. The chaff photo and bag no longer share a path of motion.

**Curtain layer (unchanged visually):**
- Full-viewport `#f2f1ea` panel, centered, z-index 10
- Editorial stripe: 380px tall, text panel left (42%) / chaff photo right (58%)
- Text: "THE TASTE FINDER" eyebrow → "Which / [archetype] / is yours?" headline (pink `#ee5974` pill on "archetype", `#f2f1ea` text) → body copy → "TAKE THE QUIZ →" CTA
- Stripe lifts with the curtain panel as a single unit

**Revealed layer (new):**
- Left 50%: `TransparentBag03.png` — centered, `height: 65vh`, `objectFit: contain`, left padding scales with viewport
- Right 50%: right-aligned text block, nudged below center via `paddingTop: 8vh`
  - Body: *"Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match."* — Genova Regular, `clamp(1rem, 1.4vw, 1.2rem)`, terracotta `#9a2918`, `lineHeight: 1.75`
  - CTA: `TAKE THE QUIZ →` — `0.78rem`, `letter-spacing: 0.2em`, terracotta `#9a2918`, underline border-bottom

**Animation timing:** Curtain lifts from 10%→90% of scroll progress through the 200vh section. Footer appears naturally in document flow after the section completes.

---

### 30. About page — full editorial redesign
**File:** `frontend/src/app/components/About.tsx`

Complete redesign of the About page. Replaced the old corporate team-directory layout (split hero, separate founder photos, bio cards) with a cinematic, intimate, editorial page using the same visual language as the homepage.

**Removed:**
- Animated split-screen hero with terracotta/cream panels and spinning `&` ampersand
- Separate Dana photo (was loading from imgur)
- Separate founder bio cards
- `TasteFinderSection` at the bottom

**Page structure — 7 sections:**

**1. Hero**
- Full-viewport (`100vh`) with `FamilyEdit.jpg` as full-bleed background, `objectPosition: center 30%`
- Bottom-weighted gradient overlay: `rgba(15,12,11,0.75)` → transparent
- Bottom-left text block: "OUR STORY" eyebrow (`#bf6a58`), "About Axis & Bloom" h1 (`#f2f1ea`, `clamp(3rem, 6vw, 6rem)`), italic-free subheading at 72% cream opacity
- `motion.div` entrance: `opacity 0→1`, `y 22→0`, 1.1s delay 0.3s

**2. Brand Story**
- `#f2f1ea` background, generous vertical padding (`clamp(88px, 11vw, 148px)`)
- Two-column flex: left (`~26%`) has "WHAT WE ARE" eyebrow + "A new way to discover coffee." heading; right (max 640px) has 5-paragraph editorial body copy
- Key paragraph in terracotta for emphasis: "Instead of asking you to become a coffee expert…"
- Full brand narrative from the brief, edited for web readability

**3. Axis / Bloom**
- `#e5e5da` background
- "THE NAME" eyebrow + two side-by-side blocks (3px gap):
  - **Axis block**: `#9a2918` terracotta background, ghost "Axis" lettering at 12% opacity (Genova Black), "The point of orientation." heading in cream, body copy at 62% cream opacity
  - **Bloom block**: `#f2f1ea` background with terracotta border, ghost "Bloom" lettering at 8% opacity, "What opens from there." heading in terracotta, body in gray
- Both blocks `minHeight: 340px`, flex column with space-between

**4. A Note from Us**
- `#f2f1ea` background, same two-column structure as Brand Story
- Left: "A NOTE FROM US" eyebrow, "Camila & Dana" label, thin 32px divider, "Partners in life and in this project." small caps
- Right: 5-paragraph personal letter — warm, intimate tone; opening paragraph in larger terracotta for emphasis

**5. Emotional Video**
- `68vh` section, `PlaceHolder08.mp4` autoplay loop muted
- 42% dark overlay
- Bottom-left caption: "For us, coffee is a morning [pause], a shared table, a moment alone, a return." — "pause" in `#ee5974` pink pill (`#f2f1ea` text inside)

**6. Archetype Bridge**
- `#f2f1ea` background
- Two-column header: left has "THE FLAVOR SYSTEM" eyebrow + "Every palate belongs to a sensory world." heading; right has single supporting sentence
- Six archetype color swatches (72px tall, 3px gap, `overflowX: auto` for mobile) with small-caps name labels

**7. Final CTA**
- `#9a2918` terracotta background, centered
- "Which / [archetype] / is yours?" — same typographic treatment as TasteFinderSection (pink `#ee5974` pill on "archetype")
- "TAKE THE QUIZ →" link to `/find-my-flavor`, cream with faint underline

**Design system compliance:**
- All colors from palette: `#f2f1ea`, `#e5e5da`, `#9a2918`, `#bf6a58`, `#ee5974`, `#7b7f80` (gray body text)
- Genova throughout, weights 400 and 900 only
- No pure white, no pure black
- `fadeUp` animation preset (opacity/y, `whileInView`, `once: true`) consistent with homepage

---

### 31. Font audit — italic removed, Medium weight dropped, @font-face trimmed to three weights
**Files:** `frontend/src/styles/fonts.css`, `frontend/src/app/components/Shop.tsx`, `frontend/src/app/components/CoffeesPage.tsx`

Full font audit run across all CSS and component files. Findings and fixes:

**What was verified as correct:**
- `@font-face` declarations in `fonts.css` pointing to correct `.otf` files in `frontend/src/design/FONT/genova/`
- `body { font-family: 'Genova', sans-serif }` set globally in `theme.css` — cascades to all elements
- No foreign font families anywhere (`font-sans`, Arial, Helvetica, Geneva typo, system-ui) — zero occurrences
- No invalid inline `fontWeight` values (300, 600, 700, 800) in any `.tsx` file
- `* { font-style: normal !important }` guard already in place in `fonts.css`

**Fixes applied:**

1. **`fonts.css` — removed Genova-Medium (weight 500) from `@font-face`**
   - Weight 500 was registered but never used anywhere in the codebase (no `fontWeight: 500` in inline styles, no `font-medium` Tailwind class in use)
   - Preferred Genova weights confirmed by Camila: **400 Regular**, **100 Thin**, **900 Black**
   - `fonts.css` now declares exactly these three weights and nothing else

2. **`Shop.tsx` line 103 — removed `italic` Tailwind class**
   - Was: `<div className="text-xs text-[#a33726] italic">{coffee.notes}</div>`
   - Now: `<div className="text-xs text-[#a33726]">{coffee.notes}</div>`
   - Applied to tasting notes text in the coffee card

3. **`CoffeesPage.tsx` line 603 — removed `italic` Tailwind class**
   - Was: `className="text-lg font-light leading-relaxed italic"`
   - Now: `className="text-lg font-light leading-relaxed"`
   - Applied to the surprise note text in the coffee detail view

**Standing rule:** Never use italic (no `italic` class, no `fontStyle: 'italic'`) anywhere unless explicitly requested. The `font-style: normal !important` guard in `fonts.css` remains as a belt-and-suspenders safeguard.

**Remaining known issue:** `font-light` (Tailwind weight 300) appears in ~40 places across unredesigned pages (`FlavorQuiz.tsx`, `Shop.tsx`, `CoffeesPage.tsx`, `Profile.tsx`, `JoinHousehold.tsx`, `SignIn.tsx`, `FamilyTab.tsx`, `NewsletterModal.tsx`). Genova has no weight 300 — the browser falls back to Thin (100). These will be cleaned up during each page's redesign pass.

---

### 32. TasteFinderSection — full-screen curtain, footer revealed, slow timing
**Files:** `frontend/src/app/components/TasteFinderSection.tsx`, `frontend/src/app/components/Home.tsx`

Completely redesigned the scroll-driven curtain section at the bottom of the homepage.

**Curtain changes:**
- Was: a 360px-tall stripe with a cream text panel (left 40%) + chaff photo (right 60%), sliding horizontally
- Now: the chaff photo fills the full `100vh` viewport — no stripe, no text overlay on the curtain itself
- Direction: `translateX` (slides left)
- Timing: `WHEEL_OPEN` increased 480 → 900 (much more scroll required — slow, user-controlled); `WHEEL_CLOSE_HOLD` 240 → 500

**Revealed layer:**
- Left 50%: `TransparentBag03.png` coffee bag (larger, `maxHeight: 500px`)
- Right 50%: "THE TASTE FINDER / Which / [archetype] / is yours? / TAKE THE QUIZ →" — moved here from the old curtain text panel
- Text: left-aligned within the right panel, `clamp(3.2rem→5.6rem)` headline
- Footer embedded inside the revealed layer (always in DOM, visible the moment curtain opens — no extra scroll needed)

**Section 6 replacement (Home.tsx):**
- Removed: "Guided by AI. Curated by taste. / Every match is shaped by real coffees, sensory language, and human judgment."
- Added: "TAKE THE QUIZ →" CTA (first), then "Our flavor system is designed to remove the guesswork…" body copy below

---

### 33. Bag cards — crossfade archetype photo on hover
**File:** `frontend/src/app/components/Home.tsx`

Changed the hover behaviour on the three coffee bag cards in the Collection section.

- Was: archetype lifestyle photo slides down below the bag tile (expanding `max-height` from 0 → 260px)
- Now: both images are stacked inside the same tile (`position: absolute, inset: 0`); the bag fades out (`opacity 0`) and the archetype photo fades in (`opacity 1`) over 0.45s — the tile never changes size
- Bag: `objectFit: contain`; archetype photo: `objectFit: cover`

---

### 34. Homepage sections — Coffee Collection and Flavor Map swapped
**File:** `frontend/src/app/components/Home.tsx`

Reordered two homepage sections by swapping their positions. No content changed.

| Position | Before | After |
|---|---|---|
| 3 | Flavor Map (archetype color blocks) | **Coffee Collection** (bag cards) |
| 4 | Cinematic video | Cinematic video (unchanged) |
| 5 | Coffee Collection (bag cards) | **Flavor Map** (archetype color blocks) |

---

### 35. Videos — rAF loop, no poster, fade-in on play
**File:** `frontend/src/app/components/Home.tsx`

Three fixes applied to both the hero and cinematic video sections:

1. **No poster** — removed `poster={coffeePic16}` from both video elements; the static image no longer flashes before the video
2. **Fade in on `onCanPlay`** — videos start at `opacity: 0` and fade to `1` over 0.5s when the browser has the first frame ready, so users never see a black void while the video loads
3. **rAF loop** — replaced `timeupdate` event listener (fires ~4×/sec) with a `requestAnimationFrame` loop (60fps); resets `currentTime` 300ms before the end so the browser never reaches a potentially black last frame

---

### 36. Video loop — seek to 0.05s, earlier cutoff
**File:** `frontend/src/app/components/Home.tsx`

Refined the rAF loop from entry 35:

- Loop resets to `currentTime = 0.05` (not `0`) to skip any black first frame baked into the video encoding
- Cutoff moved earlier: `duration - 0.5` (was `duration - 0.3`) for a more conservative end-of-clip trigger
- `onCanPlay` used instead of `onPlaying` for faster fade-in trigger

---

### 37. Videos — scale(1.06) to remove black side bars
**Files:** `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/About.tsx`

All four video elements (Home hero, Home cinematic, About hero, About emotional) were getting visible black lines on both sides. Cause: the video files have thin pillarboxing bars encoded into the pixel data; `objectFit: cover` fills the CSS container but treats the full encoded frame (including bars) as the video content.

**Fix applied to all four videos:**
- `transform: scale(1.06)` — zooms the video 6% beyond its container; since each section has `overflow: hidden`, the outer 3% on each side (including the bars) is clipped
- `display: block` — removes the default inline baseline gap that can cause 1px edge artifacts

**About.tsx loop also updated:**
- Old `timeupdate` approach replaced with the same `requestAnimationFrame` loop used in Home.tsx
- Reset offset: `currentTime = 0.05`, cutoff: `duration - 0.5`

---

### 38. Videos — no black flash before hero loads
**Files:** `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/About.tsx`

The hero videos were still showing a black/dark screen before they started playing.

**Root cause (Home.tsx):** The `opacity: 0 → 1` approach from entry 35 was hiding the video, but the section's `backgroundColor: '#111110'` was visible the entire time the video loaded — which itself looked like a black screen.

**Root cause (About.tsx):** The `poster={coffeePic15}` JPEG needed a separate network round-trip to decode before it appeared, leaving a brief black gap on first visit.

**Fixes:**
- **Home.tsx** — Removed the `opacity/onCanPlay` approach entirely. Section `backgroundColor` changed from `'#111110'` to `'#1a1208'` (dark espresso brown) — warm and intentional-looking while the video loads, not a "black screen". The `heroReady`/`cinematicReady` state variables and their handlers were deleted.
- **About.tsx** — Section gets a CSS `background-image` (same photo as the old poster) as an inline style on the section element. CSS backgrounds are fetched with the stylesheet, before the video element initialises — so the photo appears from the very first paint with zero gap. Poster attribute removed from the `<video>` element.

---

### 39. Sign-in CTAs added site-wide alongside quiz/flavor prompts
**Files:** `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/TasteFinderSection.tsx`

Added a "Sign in" secondary option next to every quiz and flavor-discovery CTA across the site.

| Location | Addition |
|---|---|
| Hero section | "Sign in →" third link alongside "Find my flavor →" and "Explore coffees →" — same subtle cream style |
| Profile form | "Already a member? Sign in →" below the "BEGIN PROFILE →" button, 45% opacity |
| Quiz CTA section (6) | "or sign in →" below "TAKE THE QUIZ →", smaller, lowercase |
| TasteFinderSection revealed layer | "or sign in →" below "TAKE THE QUIZ →" (applies to homepage and About page which share the component) |

All sign-in links route to `/sign-in`.

---

### 40. Sign-out buttons — navigation and admin sidebar
**Files:** `frontend/src/app/components/Navigation.tsx`, `frontend/src/app/components/admin/AdminLayout.tsx`

Sign-out functionality already existed in `AuthContext` (`logout()` → `signOut(auth)`) and in the Profile page settings tab, but was not accessible from the nav or admin area.

**Navigation.tsx:**
- When `user` is truthy, a small `"SIGN OUT"` text button appears to the right of the user icon on desktop (`hidden md:block`)
- Calls `logout()` then navigates to `/`
- 55% opacity at rest, lifts to 100% on hover — clearly secondary to nav links

**AdminLayout.tsx:**
- "Sign out" button added to the sidebar footer, directly below "Back to site"
- Same visual style (text + arrow icon) as the existing "Back to site" link
- Calls `logout()` then navigates to `/`

---

### 41. Find my flavor — name screen layout redesign
**File:** `frontend/src/app/components/FlavorQuiz.tsx`

The opening name-entry screen was cramped and hard to read (text jammed into the upper-left corner of the background photo, elements too close together, heading wrapping to 3 lines).

**Final state after two iterations:**

- **Position** — `justify-start` with `paddingTop: clamp(80px, 11vh, 120px)`, placing the content block in the upper-left light area of the background photo (away from the dark chaff pile in the lower-right)
- **Heading** — `clamp(2.8rem, 4.2vw, 4.2rem)`, explicit `<br />` after "are we" so "Whose palate are we" is line 1 and "profiling today?" is line 2; container widened to `maxWidth: 640px` so the full first line fits without wrapping
- **Left padding** — `clamp(48px, 7vw, 112px)` for comfortable margin from the edge on wide screens
- **Spacing** — heading → input: `clamp(28px, 4vh, 40px)`; input → BEGIN PROFILE: `clamp(20px, 3vh, 28px)`; BEGIN PROFILE → Sign in: `18px` (immediately below, not a large gap)
- **Sign in link** — moved to directly below the button (18px gap), lowercase `"Already have a profile? Sign in →"`, 45% opacity

---

### 42. Quiz — back button to revisit previous answers
**File:** `frontend/src/app/components/FlavorQuiz.tsx`

Added a `← Back` button on the question screen that appears from question 2 onward.

- Sits to the left of "Next Question" in a horizontal flex row
- Clicking decrements `currentStep` by 1; the previous answer remains highlighted (stored in `answers` and `selectedIds` by step index)
- Changing an answer on a previous step overwrites that step's stored selection; the score is computed from whatever answers are current when the user hits "See My Profile" on the last question
- Style: `text-[10px] uppercase tracking-[0.3em]`, terracotta, 35% opacity at rest, lifts to 70% on hover — clearly secondary to the forward button

---

### 43. Quiz result — gift-unwrap reveal redesign
**File:** `frontend/src/app/components/FlavorQuiz.tsx`

Complete redesign of the result page. Replaced the generic split-screen layout (stock photo left, archetype text right) with a four-section editorial page anchored by a gift-reveal mechanic.

**New asset imports:**
- 6 archetype wallpapers from `frontend/src/design/IMAGES/archetypes/` (Floral.jpg, Fruity.jpg, Balanced-&-Sweet.jpg, Chocolate-&-Nutty.jpg, Spicy-&-Earthy.jpg, Experimental.jpg)
- 6 new mock-up bag PNGs from `frontend/src/design/IMAGES/bags/new bags mock up/` (transparent backgrounds)

**Archetype data updated:**
- All 6 archetypes now fully mapped: Floral, Fruity, Balanced & Sweet, Chocolate & Nutty, Spicy & Earthy, Experimental
- Added: `wallpaper`, `bag`, `shortDescription`, `whyMatches` fields per archetype
- Updated `ARCHETYPE_NAME_TO_KEY` to normalise all backend variants (`"Spicy & Earthy"`, `"earthy"`, `"Spicy and Earthy"`, etc.) to the correct key
- Colors updated to match brand spec: Floral `#a34b78`, Spicy & Earthy `#912f2f`, Experimental `#056c7a`

**Section 1 — Reveal hero:**
- A `200vh` container with a sticky `100vh` inner drives the reveal via scroll position
- Wallpaper (curtain) slides LEFT as the user scrolls through the extra 100vh (`translateX`, smooth 0.12s transition)
- Under the curtain: coffee bag (left half, large transparent PNG on cream background) + archetype name, description, "See your coffees →" CTA (right half)
- Bag and text fade + scale in once the curtain is >55% open
- Mobile fallback: "Reveal my archetype →" button triggers a 0.95s elegant slide (`cubic-bezier(0.16, 1, 0.3, 1)`)
- `prefers-reduced-motion`: skips animation, shows revealed state immediately
- Scroll-to-top triggered automatically when `isComplete` becomes true so the reveal always starts clean

**Section 2 — Why this matches you:**
- `#e5e5da` background
- 3 archetype-specific bullets, each with a thin 1px vertical accent line in the archetype color
- `whileInView` stagger animation

**Section 3 — Coffees selected for you (`id="coffees"`):**
- `#f2f1ea` background, editorial card layout
- Match percentage as eyebrow label, coffee name, tasting notes, "Get this coffee →" link to /shop
- "See your coffees →" CTA in the hero smooth-scrolls to this section

**Section 4 — Closing CTA:**
- `#deded1` background, centred
- Save profile prompt for non-logged-in users (links to `/sign-in`)
- "Meet all archetypes →" links to `/coffees`
- "Retake the quiz" button resets all state and scrolls back to top

---

## File Reference

| File | What changed |
|---|---|
| `frontend/src/app/components/Home.tsx` | Full editorial redesign: 9-section structure, video-ready hero, profile form, flavor map, bag preview, Human+AI section |
| `frontend/src/app/components/Navigation.tsx` | Solid bg, refined lockup, admin removed, separator removed, icons only on right |
| `frontend/src/app/components/Footer.tsx` | Editorial 3-column layout, Genova throughout, logo + links + copyright |
| `frontend/src/app/components/TasteFinderSection.tsx` | Curtain: full-screen chaff photo slides LEFT; revealed: bag (left) + taste finder text (right) + footer; slow timing; "or sign in →" added |
| `frontend/src/app/components/About.tsx` | Full editorial redesign: FamilyEdit.jpg hero, brand story, Axis/Bloom name blocks, founders' note, video, archetype bridge, final CTA |
| `frontend/src/app/components/PreLaunch.tsx` | New — pre-launch curtain page; iterated visually; mobile layout fixed |
| `frontend/src/app/App.tsx` | Conditional pre-launch routing + preview bypass |
| `frontend/src/styles/fonts.css` | Genova @font-face: 3 weights only (400, 100, 900); Medium removed; italic guard in place |
| `frontend/src/app/components/Shop.tsx` | Italic removed from tasting notes; font-light instances remain (pre-redesign) |
| `frontend/src/app/components/CoffeesPage.tsx` | Italic removed from surprise note text |
| `frontend/src/styles/theme.css` | Global font-family on body, heading weights set to 400; 12 brand color tokens added |
| `frontend/src/design/FONT/genova/` | Genova font files (added to repo) |
| `frontend/src/design/LOGO/` | LogoCircle.svg in Flavor Map section; LogoQuarter1.svg in nav/footer |
| `frontend/src/design/IMAGES/` | Full image library: bags (used in collection), lifestyle (CoffeePic16 in hero/profile) |
| `backend/src/routes/newsletter.ts` | firstName support, Mailchimp integration |
| `backend/src/db/schema.sql` | first_name column on newsletter_subscriber |
| `.github/workflows/deploy.yml` | VITE_PRELAUNCH_MODE added; Mailchimp secrets removed until created in GCP |
| All component files | Removed font-sans; replaced all bold weights with font-normal |
| `frontend/src/app/components/Home.tsx` | Curtain CTA section replaced; bag card hover crossfade; section order swapped; rAF video loop; no poster; warm bg; scale(1.06) bar fix; sign-in CTAs added |
| `frontend/src/app/components/About.tsx` | rAF video loop; scale(1.06) bar fix; CSS background-image fallback replaces poster |
| `frontend/src/app/components/Navigation.tsx` | "Sign out" button added when user is logged in; useNavigate added |
| `frontend/src/app/components/admin/AdminLayout.tsx` | "Sign out" button added to sidebar footer |
| `frontend/src/app/components/FlavorQuiz.tsx` | Name screen layout redesigned; back button added to quiz; full result page redesign (gift-reveal mechanic, 6 archetype wallpapers + bags, 4-section layout) |
| `frontend/src/design/IMAGES/archetypes/` | 6 archetype wallpaper JPGs used in quiz result reveal |
| `frontend/src/design/IMAGES/bags/new bags mock up/` | 6 transparent bag PNGs used in quiz result revealed layer |
