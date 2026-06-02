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

## File Reference

| File | What changed |
|---|---|
| `frontend/src/app/components/Home.tsx` | COMING SOON hero, font cleanup |
| `frontend/src/app/components/Home.tsx` | COMING SOON hero, font cleanup |
| `frontend/src/app/components/PreLaunch.tsx` | New — pre-launch curtain page with logo, first name + email form |
| `frontend/src/app/App.tsx` | Conditional pre-launch routing + preview bypass |
| `frontend/src/styles/fonts.css` | Genova @font-face declarations |
| `frontend/src/styles/theme.css` | Global font-family on body, heading weights set to 400 |
| `frontend/src/design/FONT/genova/` | Genova font files (added to repo) |
| `frontend/src/design/LOGO/` | Logo files (LogoLines.svg used in pre-launch) |
| `backend/src/routes/newsletter.ts` | firstName support, Mailchimp integration |
| `backend/src/db/schema.sql` | first_name column on newsletter_subscriber |
| `.github/workflows/deploy.yml` | VITE_PRELAUNCH_MODE added; Mailchimp secrets removed until created in GCP |
| All component files | Removed inline fontFamily styles, replaced all bold weights with font-normal |
