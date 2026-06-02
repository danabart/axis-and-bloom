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
- Left half (`#f0ebe1`): inline SVG logo mark — AXIS / decorative & / BLOOM — in Genova Thin, centered
- Dividing line: `1px solid #a3372620`
- Right half (`#f0ebe1`): centered column with three elements:
  1. Tagline text — Genova Regular, `1.1rem`, `#a33726`, `letter-spacing: 0.05em`, uppercase: `YOUR COFFEE IDENTITY. COMING SEPTEMBER 1.`
  2. Thin separator line — `1px solid #a3372630`
  3. Email input — border-bottom only (`1px solid #a33726`), transparent background, Genova `0.9rem`, placeholder in `#a3372680`
  4. `JOIN →` button — no background, no border, Genova Regular, `0.85rem`, `letter-spacing: 0.1em`, hover opacity `0.6`

**Mobile:** stacks vertically — logo on top half, content on bottom half (breakpoint: 768px).

**Email submission:** wires to the existing `/api/newsletter/subscribe` backend endpoint. On success, shows "You're on the list."

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

## File Reference

| File | What changed |
|---|---|
| `frontend/src/app/components/Home.tsx` | COMING SOON hero, font cleanup |
| `frontend/src/app/components/PreLaunch.tsx` | New — pre-launch curtain page |
| `frontend/src/app/App.tsx` | Conditional pre-launch routing + preview bypass |
| `frontend/src/styles/fonts.css` | Genova @font-face declarations |
| `frontend/src/styles/theme.css` | Global font-family on body, heading weights set to 400 |
| `frontend/src/design/FONT/genova/` | Genova font files (added to repo) |
| `.github/workflows/deploy.yml` | `VITE_PRELAUNCH_MODE: 'true'` added to build env |
| All component files | Removed inline fontFamily styles, replaced all bold weights with font-normal |
