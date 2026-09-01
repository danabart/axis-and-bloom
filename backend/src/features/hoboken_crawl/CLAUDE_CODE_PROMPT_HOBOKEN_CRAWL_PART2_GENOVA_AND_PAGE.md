# Feature: Hoboken Crawl Part 2 — Lato site-wide (for real this time) + `/crawl` rebuilt to Camila's handoff

> **REVISION 2026-09-01 (later the same day):** Task A is now **Lato**, not Genova. Dana and Camila decided not to take on font licensing before launch; Lato is SIL OFL (free for web/desktop/email). Every "Genova" in Task A below has been rewritten; Task B builds the page in Lato using Camila's sizes, colors, spacing and copy unchanged. If you already started Task A with Genova: discard that work (`git checkout -- .` on the affected files, delete `frontend/src/design/FONT/genova/` and `.../montserrat/`), then do Task A as written here.

> Folder: `backend/src/features/hoboken_crawl/` · Decided: 2026-09-01 (Dana) · Model: Sonnet is fine (two contained tasks; the second is a faithful port of an approved mockup)
> Status: ⏳ not executed
> Depends on: Part 1 executed (WHAT_WE_BUILT.md #173, commits a08bbc3 + d79dc1f): `/crawl` route, `lib/campaign.ts`, `POST /api/campaign/landing`, campaign columns + views. **Keep all of that; this part changes how the page looks and how the name reaches the quiz, not attribution.**
> Hard date: event is **Sunday, September 20, 2026**.

## Why two tasks in one brief

Camila's approved page (`43-crawl-page-handoff.md` + `42-crawl-landing-mockup-v9.html`, both in this folder under `43-crawl-page-deploy-package/`) is set in Genova. While surveying, we found the site is not:

- `cab3716` (2026-07-05) switched the site from Genova to Lato in 11 files, one day after `98267e2` had restored Genova site-wide.
- The Lato file it references (`frontend/src/design/FONT/Lato/Lato-Regular.ttf`) **was never committed** (`git ls-files | grep -i lato` is empty; `frontend/src/design/FONT/` does not exist). Vite prints a Lato asset-resolution warning on every build (build log #3981 calls it "pre-existing"). The `@font-face` therefore fails and the browser falls through the stack in `theme.css` (`'Lato', Arial, ui-sans-serif, ...`) to **Arial**. The live site has been rendering in Arial since July 5.
- WHAT_WE_BUILT.md line ~1137 ("Genova font site-wide — 3 weights") and the Part 13/15 commit messages ("brand language (Genova, ...)") describe Genova, but the code they shipped inherits the body font. Build-log item ~4481 already documents `font-light` collapsing to Thin as an open issue.
- The Genova TTFs Dana supplied live at `misc/design_documents/genova/` (commit `383184e`) and in the bucket at `raw/fonts/genova/` — used by email templates only. Camila's package adds OTFs for Genova (Thin/Regular/Medium/Black) and Gotham (Light/Medium).

Dana's decision (2026-09-01, revised later that day with Camila): **Lato site-wide, installed properly** (real files, real weights), so the July 5 decision finally takes effect. Genova and Gotham are commercial fonts with no web license held; neither is served from the site. Genova stays in Camila's print work and in the existing email templates (out of scope here).

## Decisions already made (Dana, 2026-09-01) — do not re-open

1. Lato site-wide, real weight files, as Task A. No Genova, no Gotham, no Montserrat anywhere in `frontend/`.
2. Handoff §4's ampersand/question-mark rules were about Genova's odd glyphs; with Lato they do not apply. Use Lato's own `&` and `?`. No glyph utilities, no text-stroke.
3. `/crawl` collects the name and the quiz **skips its own entry screen**; the first-name field on the post-quiz email card is **prefilled** with it (still editable, still required).
4. No sticky mobile button.
5. Attribution mechanism from Part 1 stays exactly as is. Handoff §7's "preserve UTMs through the flow" is already satisfied by the localStorage stamp + visitor key; **do not** forward UTM params into the quiz URL or anywhere else.
6. Camila's copy ships character for character (handoff §3). The six-tile field guide and the old copy from Part 1 are **removed** (superseded by her design; the field guide lives on the printed card's back).
7. Fonts are **bundled in the repo** (Vite-hashed), not loaded from the bucket: `@font-face` across origins needs bucket CORS that images never needed, and a CORS misconfiguration would silently fall back to Arial again. The bucket copies used by emails stay untouched.

---

## TASK A — Lato site-wide, installed properly (commit 1)

### A1. Font files

- Get **Lato 2.0** from the official source, latofonts.com (Łukasz Dziedzic, SIL Open Font License 1.1) — it ships Medium 500 and Semibold 600, which the Google Fonts subset lacks. Convert to WOFF2 (`pip install fonttools brotli`, then `fontTools.ttLib.TTFont(path); f.flavor = 'woff2'; f.save(out)`, or `npx ttf2woff2`). Place under `frontend/src/design/FONT/lato/`: `Lato-Light.woff2` (300), `Lato-Regular.woff2` (400), `Lato-Medium.woff2` (500), `Lato-Bold.woff2` (700), `Lato-Black.woff2` (900). Include the license as `frontend/src/design/FONT/lato/OFL.txt`. Upright faces only (the site's italic guard makes italics dead weight).
- **Do not copy, convert, or reference any Genova, Gotham or Montserrat file anywhere in `frontend/`.** The OTFs in this folder's package stay as Camila's print archive.
- Verify each WOFF2 opens and reports the expected `usWeightClass` (300 / 400 / 500 / 700 / 900).

### A2. `frontend/src/styles/fonts.css`

Replace the dead single-file block with one `Lato` family at five faces. Weight **ranges** are deliberate so every Tailwind weight class resolves to a real face and nothing fake-bolds or falls to a hairline (closes build-log item ~4481 without touching page JSX):

```css
@font-face { font-family: 'Lato'; src: url('../design/FONT/lato/Lato-Light.woff2') format('woff2');   font-weight: 100 300; font-style: normal; font-display: swap; }
@font-face { font-family: 'Lato'; src: url('../design/FONT/lato/Lato-Regular.woff2') format('woff2'); font-weight: 400;     font-style: normal; font-display: swap; }
@font-face { font-family: 'Lato'; src: url('../design/FONT/lato/Lato-Medium.woff2') format('woff2');  font-weight: 500 600; font-style: normal; font-display: swap; }
@font-face { font-family: 'Lato'; src: url('../design/FONT/lato/Lato-Bold.woff2') format('woff2');    font-weight: 700 800; font-style: normal; font-display: swap; }
@font-face { font-family: 'Lato'; src: url('../design/FONT/lato/Lato-Black.woff2') format('woff2');   font-weight: 900;     font-style: normal; font-display: swap; }
```

Keep the existing `* { font-style: normal !important; }` italic guard. Add `font-synthesis: none;` on `html` so the browser never fabricates a bold. No glyph utilities.

### A3. Font references

`theme.css` (body + `--font-sans`, lines ~113/118) already says `'Lato', Arial, ...` and the components `cab3716` touched already say Lato; leave those strings as they are. Only: `grep -rn "Genova\|Gotham" frontend/src` must return nothing in production code (mockup HTMLs under `frontend/src/features/` are design references, leave them), and any `fontFamily` that still says something else (`Arial`, `Fashion Fetish`, `inherit`-breaking literals) becomes `'Lato', sans-serif`. Do **not** touch `Shop.tsx` (design/CLAUDE.md hard rule) unless it is the only file with a stray literal, in which case change the string only.

### A4. Verify, don't assume

- `vite build`: the Lato asset warning is gone; five Lato WOFF2 assets are emitted; `grep -ri "genova\|gotham\|montserrat" frontend/dist` returns nothing.
- In a real browser on the built site: `document.fonts.check('300 16px Lato')`, `'400'`, `'500'`, `'700'`, `'900'` all true; computed `font-family` on `body` resolves to the loaded Lato (not a locally installed copy — test in a browser profile without Lato installed, or check the network panel shows the WOFF2 loading); Tailwind `font-light` → Light face, `font-semibold` → Medium face, `font-bold` → Bold face, no synthetic bold.
- Visual pass at 390px and 1280px over the pre-launch open pages: `/` (curtain), `/find-my-flavor` (entry screen, one question, the sealed ending card, confirmation state), `/sign-in`, `/profile` (with a real account), `/privacy`, `/terms`; and with `?preview=true`: `/bloom`, `/flavor-intelligence`, `/how-it-works`. Look for overflow, clipped buttons, wrapped headlines that now break mid-word, and nav items wrapping. **Fix only outright breakage** (overflow/clipping); list every merely-cosmetic difference in the report and in `OPEN_TASKS.md` for Camila to judge. This is the one part of the brief with a wider blast radius; report it fully.

---

## TASK B — `/crawl` per Camila's handoff (commit 2)

Source of truth: `43-crawl-page-handoff.md` (structure, copy, type, color, photo crop, QA list) and the CSS inside `42-crawl-landing-mockup-v9.html`. Read both in full before writing code. Strip `.mocktitle` and `.notes/.notetoggle/.note` (mockup chrome). Lift the remaining CSS values as-is; the mockup contains no `#fff`/`white`, keep it that way.

### B1. Rewrite `CrawlLanding.tsx`

- **Keep** the Part 1 behavior verbatim: `rememberCampaign(...)` on mount, `trackEvent('CampaignLanding', …)`, fire-and-forget `logCampaignLanding(...)` with UTMs/referrer, `reportError` wrapping, route registration, `PRELAUNCH_OPEN_ROUTES` entry, absence from nav/footer, the Privacy line. Remove the Part 1 markup, the six tiles, the `ARCHETYPE_VISUALS` import and the old copy constants.
- Build the page exactly as handoff §3 items 1–12, in order, in **Lato** with the handoff's weights mapped as: Genova Thin 100 → Lato Light 300; Regular 400 → 400; Medium 500 → 500; Black 900 → 900. Keep every size, letter-spacing, line-height, max-width and color exactly as specified; Lato's `&` and `?` are used as-is (no glyph swaps). If the two-line H1 (`HEY,` / `HOBOKEN`) no longer fits one word per line at 54px on a 375px viewport with Lato's metrics, reduce the mobile H1 size in 2px steps until it does and report the final value; change nothing else. §5 colors only, §6 photo band, beige background, column max-widths 560/720, 30px side padding. Logo mark: reuse the inline quarter-round SVG from the mockup **only if** `brandAssets.logoQuarter1` (already used by `PreLaunch.tsx`) is a different asset; otherwise reuse `brandAssets.logoQuarter1` at 24px. Report which.
- Copy: character for character from §3. No em dashes except the `FROM: AXIS & BLOOM — TO: HOBOKEN` lockup. `Good.` highlight block, `palate` in pink, `FOR CRAWLERS ONLY` / `ships free` / `first match free` spans exactly as specified. Put all copy in one constants block at the top of the file.
- Button is a real `<button type="submit">` inside a `<form>`; Enter submits; disabled (with the mockup's disabled styling if it has one, otherwise `opacity .3` + `cursor: not-allowed` like the quiz's own entry button) until the trimmed name is non-empty. Input: `font-size` 19px (≥16px prevents iOS zoom-jump), transparent background, 1px `#c5c7c8` bottom border, placeholder color from the palette (gray `#7b7f80`), focus state uses pink or terracotta border, never white/blue outline.
- `document.title`: `Hoboken Coffee Crawl · Axis & Bloom`.

### B2. Name handoff into the quiz — reuse the existing mechanism, zero quiz changes for the start

`Home.tsx` (~line 401) already writes `sessionStorage.setItem('axisBloomCustomerName', visitorName.trim())` and `FlavorQuiz.tsx` (~line 912) already reads that key on mount, calls `setUserName(savedName); setHasStarted(true)` and removes it. On submit, `/crawl` does exactly the same write, fires `trackEvent('CampaignCTA', { campaign })`, then `navigate('/find-my-flavor')`. Do not add a second key, router state, or a query param.

### B3. Email-card prefill (small, benefits every quiz taker)

`PostQuizEmailGate.tsx`: new optional prop `initialFirstName?: string`, used as the `useState` initial value for `firstName` (still editable, still required, submit logic unchanged). `FlavorQuiz.tsx` passes `initialFirstName={userName}` at both render sites (~lines 1760 and 1935). Nothing else on the card changes.

### B4. Photo through the asset registry (design/CLAUDE.md rules)

- `frontend/src/design/assets.ts`: add `export const campaignAssets = { hobokenCrawl2026: { photoBand: optimized('campaigns/hoboken-crawl-2026/photo-band') } };` (role-based name per design/CLAUDE.md: it is the page's photo band, whatever picture is in it after the reshoot). The Cloud Function produces the `.webp` + `-mobile.webp` from the raw upload; never write to `optimized/` directly.
- Upload path to report: **`raw/campaigns/hoboken-crawl-2026/photo-band.jpg`** (source: `43-crawl-page-deploy-package/hoboken-photo.jpg`, 1800×1202). Try `gsutil cp` yourself; if permission is denied, do **not** work around it: stop that step and put the exact path in the report for Dana/Camila to upload via the Cloud Console. The page must render correctly either way: the band has the beige background so a not-yet-uploaded image shows a plain stripe, never a broken-image icon (use `onError` to hide the `<img>`).
- `<picture>`/`mobileSrc` like other pages; `object-fit: cover`; crops per §6 (178px / `48% 60%` mobile; 480px / `48% 52%` desktop); alt text per §6; `loading="eager"`, `decoding="async"`.

### B5. Not in scope

Sticky CTA; forwarding UTMs; changing the sealed ending, the match email, the Mailchimp sync or any Part 1 backend; any Genova/Gotham/Montserrat file or glyph rule; the Museum/Crawl logos (not on Camila's page); new copy.

---

## CONSTRAINTS

Reuse over reinvention (standing rule): the `axisBloomCustomerName` handoff, `brandAssets`, `assets.ts`, `lib/campaign.ts`, `logCampaignLanding`. No new endpoints, no schema changes. `vite build` **and** `npx tsc --noEmit` clean (same 12 known pre-existing errors, zero new). No `#ffffff`/`white` anywhere on `/crawl`. Positive register in any string you add yourself (you shouldn't need to). Do not send to real third-party addresses; disposable marked test data + cleanup.

## DONE = (run the whole sequence in ONE go, report ONCE at the end)

1. Two commits pushed to `main`: `typography: install Lato properly (five weights, bundled), fix the dead font reference` and `crawl: rebuild /crawl to Camila handoff v9, name handoff, email-card prefill`. Deploys green; backend startup log clean (`DB schema verified`, no errors; no schema change expected).
2. Build-log entry in `WHAT_WE_BUILT.md` (next number) covering both commits, including the Genova/Lato/Arial history above so the design-system line ~1137 is no longer misleading (append a correction note near it or in the new entry; do not rewrite history entries).
3. This file's Status line flipped.

## ACCEPTANCE (live browser on production, phone-sized and desktop; plus prod DB reads)

**Task A**
1. `document.fonts.check` true for Lato 300/400/500/700/900 on `/`; the WOFF2 files load from our bundle (network panel), no font asset warning in the build; no Genova/Gotham/Montserrat in `frontend/dist`.
2. `font-light` element → Regular face; `font-bold` → Black face; no synthetic bold.
3. Visual pass list from A4 done at 390px and 1280px; breakage fixed; cosmetic notes listed.

**Task B**
4. Handoff §8 items 1, 3, 4, 5 and 7 pass, with item 1 read as "Lato 300/400/500/900 all resolve to real faces; the H1 is Medium, not synthetic bold" and item 2 not applicable (no glyph rule). Photo crops at 375/390/900/1440 (the image is already uploaded), no zoom-jump on focus. Include full-page screenshots at 390px and 1280px for Camila, since she has not seen the page in Lato.
5. `/crawl?utm_source=hoboken-crawl&utm_medium=print&utm_campaign=hoboken-crawl-2026` without `?preview=true` renders Camila's page; a `campaign_landing_event` row lands with the UTMs (Part 1 regression).
6. Type a name, press Enter → `/find-my-flavor` opens **directly on question 1** (entry screen skipped), name shown wherever the quiz shows it (e.g. the wrap overlay / `{userName} —` line).
7. Complete the quiz → sealed email card shows the **first-name field prefilled** with the typed name and editable; submit → `newsletter_subscriber` row has `first_name` = that name, `campaign = 'hoboken-crawl-2026'`, `campaign_vid` set; `quiz_funnel_event` rows carry the campaign (Part 1 regression).
8. Control: `/find-my-flavor` opened directly still shows its own entry screen; a quiz taken from `/` (Home name form) still hands the name through as before; email card prefill works there too.
9. Button disabled with empty/whitespace name; `?preview=true` on `/crawl` still unlocks the site; `/crawl` absent from nav/footer.
10. Report the photo upload path and whether the upload succeeded; report which logo asset was used.
11. Cleanup: delete marked test rows (subscriber, funnel, landing) and any test Mailchimp member.

## After execution (Dana / Camila)

- Photo already uploaded by Dana (2026-09-01) to `raw/campaigns/hoboken-crawl-2026/photo-band.jpg`; Claude Code skips the `gsutil` step and only verifies the optimized variants exist.
- Camila: review the A4 cosmetic list (font metrics changed from Arial to Lato on every page) and the `/crawl` screenshots; regenerate the QR to the URL in Part 1 if not done yet; scan the printed card (handoff §8 item 6).
- After the reshoot: swap the file at the same bucket path; re-tune `object-position` only if the new frame needs it.
