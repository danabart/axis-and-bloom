# Closing report — Website 3 (Homepage)

Brief: `CLAUDE_CODE_PROMPT_WEBSITE_3_HOME.md` · Run: 2026-11-05 · Mode: test, then push (G1.6).

## Task 0 — findings (read-only, written before any change)

### 0.1 Current `Home.tsx` (`frontend/src/app/components/Home.tsx`, 691 lines)

- **Lifecycle CTA:** `getHomepageState()` is called when `user` is truthy, which includes anonymous guests. It returns `{ stageCode, archetype, daysSinceQuiz, pendingFeedback, usualBlend, nextDeliveryDate }`.
  - **Where it renders:** in §2 "The question". The anonymous form shows when `!user || (user.isAnonymous && !homepageState)`; otherwise `renderSignedInCTA()` runs, which renders nothing while loading or without state.
  - **Stages:**

| `stageCode` | Headline | Primary | Secondary |
|---|---|---|---|
| `NEW_NO_QUIZ` | Ready to find your flavor? | Take the quiz → `/find-my-flavor` | none |
| `QUIZ_TAKEN_FRESH_NO_ORDER` | You're a {archetype.name ?? 'match'} — shop your matches. | Shop your matches → `/shop` | none |
| `QUIZ_TAKEN_SETTLED_NO_ORDER` | (same as above) | (same as above) | Retake the quiz → `/find-my-flavor` |
| `QUIZ_STALE_NO_ORDER` | (same as above) | (same as above) | Palates change — retake anytime → `/find-my-flavor` |
| `SUBSCRIBER` | Your subscription is on track. | Manage subscription → `/profile` | body: "Next shipment: {Month D}" when `nextDeliveryDate` is set |
| `REORDER_DUE` | Ready for more {usualBlend.name ?? 'your usual'}? | Reorder → `/shop` | none |
| `LAPSED_SINGLE_ORDER` | New arrivals since your last order. | See what's new → `/shop` | none |
| `ACTIVE_REPEAT_USER` and any other stage | Welcome back. | Shop again → `/shop` | none |

- **Feedback nudge:** `OrderFeedbackForm` renders above the stage CTA when `pendingFeedback` is set and the nudge is not dismissed.
  - "Not now" writes `localStorage axisBloomFeedbackDismiss_<orderId>` with the current time; the nudge stays hidden for `FEEDBACK_NAG_SUPPRESS_DAYS = 14` days.
  - Submitting the form also hides it.
- **Gift widget:** `CompanyGiftRedemption onRedeemed={refreshHomepageState}` sits in its own band directly under §2, so redeeming a code refreshes the stage.
- **Name capture: there is a mismatch.**
  - Home keeps the typed name in `localStorage axisbloom.name`.
  - `/find-my-flavor` (`FlavorQuiz.tsx:951`) reads only `sessionStorage axisBloomCustomerName`, then prefills the name and skips its entry screen.
  - Home writes that session key only when "Begin" is clicked, and the click does nothing when the field is empty (`preventDefault`).
  - So a visitor who types a name and then reaches the quiz any other way (the menu, the Find My Flavor link) arrives without it.
  - `TasteFinderSection` reads `localStorage axisbloom.name`.
- **`TasteFinderSection`:** §10, a "gift" unwrap with the visitor's name and archetype. It is also imported by `About.tsx`, `HowItWorks.tsx` and `Shop.tsx`, so the file stays.
- **`FilmModal`:** opened by the hero's "Watch" pill and by the "July 26" poster in §8. Its source is `videoAssets.homeHero`.
- **Video handling:** each of the two videos has a rAF loop fix that jumps to 0.05 s when within 0.5 s of the end, to avoid a black-frame tail. An `IntersectionObserver` plays a video at ≥5 % visibility and pauses it otherwise.
- **Reduced motion:** `useReducedMotion()`. Quote rotation stops (static) and the Liam word reveal shows at once.
- **Other content on today's Home that the handoff has no place for:**
  - §1 film hero "Do you hear me?". It becomes 09 Film.
  - §3 pull quote "The best gift is time".
  - §5 photo essay, whose "See all photographs" link goes to `/essays`. **`/essays` is not a route** (`App.tsx`), so that link is dead today.
  - §8 "The months" (July 26 poster → FilmModal; August–October placeholders).
  - §9 "How it works", which becomes 07 The Axis steps.
- **Analytics:** none on Home (no `trackEvent` import).

### 0.2 Handoff page (`source/homepage-data/index.html`)

- **Sections and CSS:**
  - 01 `.fams` / `.fam` (+ `.fam-photo`, `.fam-tint`, `.fam-top`, `.fam-bottom`, `.fam-num`, `.fam-name`, `.fam-words`, `.fam-shop`). Horizontal scroll-snap at ≤900px, 62vw panels.
  - The header floats over as `.strip-hdr`.
  - 02 `.menu` (nowrap, `clamp(26px,4.7vw,78px)`).
  - 03 `.fmf` (5fr/7fr) with `.mat`, `.field`, `.btn`.
  - 03b `.whyg`, `.why-h`, `.why-p`.
  - 04 `.facts` / `.fact`, `.fact-n`, `.fact-more` (shown on hover).
  - 05 `.know` (5fr/7fr), a figure in `.mat` 5/4.
  - 06 `.voices`, `.quote-box`, `.quote`, `.fading`.
  - 07 `.fot.fot-beige`, `.fot-head`, `.fcards` / `.fcard.fcard-step` (+ `.step-img`, `.fcard-dial` with an inline dial SVG), `.fot-foot`.
  - 08 `.liamg`, `.thread`, `.thread-q`, `.thread-a`, `.sugg`, `.typing`, `.caret`.
  - 09 full-bleed `video` with `clamp(640px,54vw,900px)`, an ink scrim at .18, `.hero-h`, a `.btn`, and two `.icon-btn` buttons (play/pause, unmute).
- **The three scripts:**
  - **Quotes:** HOLD 7000 ms and FADE 1400 ms. Pauses on hover; reduced motion shows the first quote static. A "widow" helper puts a non-breaking space before the last word.
  - **Liam:** an IntersectionObserver at .4 starts `play()`. The question types at 38 ms per char, then three typing dots, then the answer at 16 ms per char, then the suggestions. It replays after 14 s; reduced motion shows the full text.
  - **Menu:** already ported in Website 1.
- **Media:**
  - `photo-{floral,fruity,balanced,chocolatenutty,earthy}.jpg`, `axis-quiz.jpg`, `axis-cupping.jpg`, `hero-loop.mp4`, `hero-poster.jpg`.
  - `pour.jpg`, `window.jpg` and `bag.png` are in `media/` but **not referenced by this page**.
- **At 390px, 02 `.menu` overflows:** it is `nowrap`, and at the 26px minimum the three words need about 430px.

### 0.3 Brief 2 endpoints (prod `axis-bloom-backend-oiub7eumya-uc.a.run.app`, 2026-11-05)

- **`GET /api/home/content`** is live:
  - `facts {questions: 6, dimensions: 8, families: 5}`.
  - 8 quotes.
  - `featured` = Chocolate & Nutty slot 2, Coado, 12 oz, $32.00, signature notes Almond · Chocolate · Peanuts.
- **`GET /api/coffees/archetypes`** returns the 5 `is_archetype` families, ordered by `v_coffee_archetype.sort_order`: Floral, Fruity, Balanced, Chocolate & Nutty, Earthy.
  - Each carries `customerWords`.
  - **The payload has no `sortOrder` field.** The brief numbers the panels "from `sort_order`", so I add `sortOrder` to that response (additive; no route, no schema).
  - The frontend has no `getArchetypes()` in `lib/api.ts`; pages `fetch('/api/coffees/archetypes')` directly. I add one.
- **The "0–15" scale is not in any public payload.** It lives in `coffee_dimensions.scale_min/scale_max` (and in `cupping_scale`, but only for admin and cupping).
  - The existing dimension payloads (`/archetypes` `dimensionScale{Min,Max}Label`) carry only the word labels.
  - To keep "0–15" off the page as a typed number, `getHomeFacts` adds `scaleMin`/`scaleMax`: `MIN(scale_min)`/`MAX(scale_max)` over the same numeric dimensions it counts. This is additive on brief 2's service.
- **Fruity's gentle end** (first slot by sort order) is "Clean Fruit", slot 1, active.

### 0.4 Assets

- **Not in the bucket yet:** `optimized/home/family-*` and `raw/video/home-loop.mp4` both return 404.
- **Exist:** `archetypes/*/hero`, `home/scan-*` and `video/home-hero*`.
- **Handoff family photos compared by eye** with the bucket (`archetypeAssets.*.hero` and `homeAssets.scan.*`):
  - **floral:** the same shot as `archetypeAssets.floral.hero` (rose petals and beans around a glass on wood), with a different crop and grade.
  - **chocolate-nutty:** a tight crop from the scan series (beans, pecans, cacao on black). Close to `homeAssets.scan['chocolate-nutty']` but a different frame.
  - **earthy:** a tight crop of `homeAssets.scan['spicy-earthy']` (same spices and cup), with a different frame.
  - **fruity:** a new photograph (glass mug with dried orange on dark wood). It matches neither.
  - **balanced:** a new photograph (glass mug on brick steps with the yellow "Balanced" card). It matches neither.
- None is a byte or framing duplicate, so all five get their own keys.
- **Fallback until Camila uploads:** `archetypeAssets[slug].hero` for each image, `videoAssets.homeHero` for the loop, and `videoAssets.homeHeroPoster` for the poster.

### 0.5 Other reuse confirmed

- **Add to cart:**
  - The dial card's add-to-cart is `DialArchetypeSection.handleAddToCart` / `ArchetypeSection.handleAddToCart`. Both build `{kind:'dial', archetype, archetypeLabel, dialSortOrder, weightOz, platformName, retailPriceCents, qty:1}`.
  - For any `user` (guests included) they then call `setDialPosition(archetype, dialSortOrder, {trigger:'add_to_cart', source, coffeeId})` from `lib/api.ts`. The featured card reuses that call with `source: 'home'`; the server ignores `source`.
- **Liam access:** `useAuth().hasLiamAccess`, plus `?redirect=` on `/sign-in`. `SignIn.tsx:26` honours it.
- **Prelaunch:** `HomeOrPrelaunch` renders `PreLaunch` instead of `Home` while gated, so Home itself never shows gated today. The gated branches are still built and tested.
- **Shared code:**
  - `Navigation` takes `floating` and `tone`. Its legacy `[data-hero]` detection was only used by Home.
  - `PublicLayout` hides the footer on `/`. That was a stale reason (`TasteFinderSection`); the handoff draws the footer.
  - Family colours come from `ARCHETYPE_VISUALS[code].color` (`bloom/bloomVisuals.ts`), and they match the handoff plates.

### Verdict

Nothing contradicts the brief, so the build goes ahead. Deviations taken, each explained below:
- `sortOrder` added to `/archetypes`.
- `scaleMin`/`scaleMax` added to the home facts.
- The name is written to the quiz's session key as it is typed, and an empty name no longer blocks the quiz button.
- Footer shown on `/`.
- `.menu` wraps below 560px.

## What was built

- **`Home.tsx`, section for section from the handoff** (styles in `home/home.css`, ported from `source/homepage-data`):
  - **01 Families:** five `Link` panels from `getArchetypes()`:
    - Number from `sortOrder`, name, `customerWords`, colour from `ARCHETYPE_VISUALS`.
    - Photo from `homeAssets.family[slug]` with the `archetypeAssets[slug].hero` fallback.
    - "Explore {name}" → `/shop#{code}`; when gated, the panels go to `/find-my-flavor`.
    - The header floats over in paper (`PublicLayout` → `Navigation floating tone="paper"`).
  - **02 Menu row:** The Axis / The Bloom / Find My Flavor (only Find My Flavor while gated).
  - **03 Find my flavor:**
    - Photo, "Ready to see your shape?", the lead "{n} questions about…", the first-name field, and "Take the {n}-question quiz".
    - "Have a profile? Sign in" for signed-out visitors and guests.
    - **Lifecycle:** any stage other than `NEW_NO_QUIZ` replaces the invite with the stage's headline, body and primary link (the same texts as before), on the design's h2 and `Btn`. The feedback nudge (`OrderFeedbackForm` + "Not now") renders above. `CompanyGiftRedemption` sits directly under the section in its own `Wrap`.
  - **03b Why:** copy as drawn.
  - **04 In numbers:**
    - `facts.questions` / `facts.dimensions` / `facts.families`, zero-padded; "01 Shape that is yours" is copy.
    - The hover lines show the dimension count and scale, and the family names from the payload.
    - On touch (`hover: none`) the lines are always visible; keyboard focus works through `tabIndex`.
  - **05 Know what you like:**
    - Lead with `facts.families` / `facts.dimensions`, "from partner roasteries" (D14).
    - The figure is `featured`: family number and label, platform name, signature notes, "{oz} oz whole bean · {price}", and "Add to cart ↗". Add to cart sends the dial item shape plus `setDialPosition(…, {trigger:'add_to_cart', source:'home', coffeeId})` for any `user`, the same as `ArchetypeSection` / `DialArchetypeSection`.
    - The photo follows the featured family.
    - The figure and the Shop link are hidden while gated.
  - **06 Voices:** the API quotes; holds 7 s, fades 1.4 s, pauses on hover; reduced motion shows the first quote static.
  - **07 The Axis:** three step cards with hover photo / dial art. "Answer {n} questions"; "{dimensions} dimensions · {min}–{max}"; the link goes to `/the-axis`.
  - **08 Liam:**
    - The typed exchange plays once in view, then loops; reduced motion shows it static. Screen readers get the full exchange once.
    - Its words: "Why {Fruity} and not {Floral}?". The answer names Fruity's gentle-end slot (the lowest `dialSortOrder` of Fruity; "Clean Fruit" on prod) and drops "next to …" when there is none.
    - "Talk to Liam": `/sommelier` with access, `/sign-in?redirect=/sommelier` when signed out, hidden without access or while gated.
  - **09 Film:**
    - `videoAssets.homeLoop` with `home-hero.mp4` as a second `<source>` (fallback); the poster is the first of `homeAssets.heroPoster` / `videoAssets.homeHeroPoster` that loads.
    - Pause off-screen and the rAF loop fix are kept.
    - The play icon opens `FilmModal` (the film with sound).
    - The second icon pauses or plays the loop (`aria-pressed`). The "[ Video placeholder ]" label is gone.
  - **Footer:** the shared `Footer` now shows on `/`.
- **Retired from Home, as the brief says:**
  - The six-bag grid.
  - `TasteFinderSection`: still imported by About, How it works and Shop, so the file stays.
  - `StripesDivider`: its file is left in place.
  - The Liam word reveal.
- **Assets (Part A):** registry keys added. Until the objects exist, every key falls back to an image that is already live (`Photo` `onError`, the `<source>` order, `useFirstLoadable`).
- **Backend, additive (no schema, no route):**
  - `GET /api/coffees/archetypes` gains `sortOrder`.
  - `GET /api/home/content` `facts` gains `scaleMin` / `scaleMax` (`MIN(scale_min)` / `MAX(scale_max)` of the counted numeric `coffee_dimensions`).
  - No new table, view or column, so `comments.sql` and `CATALOG.md` are unchanged. `homeContentReads` already read `coffee_dimensions`; `lint:lineage` and `lint:catalog` pass.

## Upload paths for Camila (Task 0.5)

Upload to `gs://axis-bloom-assets/`. The image pipeline writes `optimized/home/<name>.webp` and `-mobile.webp` from each JPG, and Home picks them up with no deploy.

| Handoff file (`source/homepage-data/media/`) | Upload to | Registry key |
|---|---|---|
| `photo-floral.jpg` | `raw/home/family-floral.jpg` | `homeAssets.family.floral` |
| `photo-fruity.jpg` | `raw/home/family-fruity.jpg` | `homeAssets.family.fruity` |
| `photo-balanced.jpg` | `raw/home/family-balanced-sweet.jpg` | `homeAssets.family['balanced-sweet']` (also 03's photo) |
| `photo-chocolatenutty.jpg` | `raw/home/family-chocolate-nutty.jpg` | `homeAssets.family['chocolate-nutty']` |
| `photo-earthy.jpg` | `raw/home/family-spicy-earthy.jpg` | `homeAssets.family['spicy-earthy']` |
| `axis-quiz.jpg` | `raw/home/axis-quiz.jpg` | `homeAssets.axisQuiz` |
| `axis-cupping.jpg` | `raw/home/axis-cupping.jpg` | `homeAssets.axisCupping` |
| `pour.jpg` | `raw/home/pour.jpg` | `homeAssets.pour` (registered; not used on this page) |
| `window.jpg` | `raw/home/window.jpg` | `homeAssets.window` (registered; not used on this page) |
| `hero-poster.jpg` | `raw/home/hero-poster.jpg` | `homeAssets.heroPoster` (read as raw) |
| `hero-loop.mp4` | `raw/video/home-loop.mp4` | `videoAssets.homeLoop` |

## Copy register (Part C, G4.4, D14): rewritten lines for Dana to review in place

| Where | Handoff | Live |
|---|---|---|
| 08 Liam lead | Nothing invented, nothing sold to you that the data does not back. | Every answer stands on what the data shows. |
| 07 card 01 | We never ask you to name a flavor or rate acidity, because almost nobody can. That is the whole point. | Moments, reactions and familiar foods: things you already know about yourself. That is the whole point. |
| 04 tile 1 | About moments, reactions and familiar foods. Never a flavor to name. | About moments, reactions and familiar foods you already know. |
| 07 card 02 (G4.4, beyond the brief's list) | … Every session stays on record. Nothing is guessed from the label. | … Every session stays on record, and every score comes from the cup. |
| 07 foot (G4.4, "not X") | Seven questions about moments, not flavor names. Your match is a shape, not a guess. | {n} questions about moments you know. Your match is a shape drawn from your answers. |
| 05 lead (D14) | … roasted to order by partner roasteries. | … from partner roasteries. |

- **Counts (D15):** "Seven" and "07" now render `facts.questions`; "eight" renders `facts.dimensions`; "0 to 15" renders `scaleMin` / `scaleMax`; "Five families" renders `facts.families`. Numbers render as digits ("6 questions"), because a spelled-out number would need a word table.
- **Stage CTA texts are unchanged.** Only the trailing "→" is dropped, because `Btn` draws the handoff's ↗ arrow.
- **Kept as drawn, flagged for Dana:** the Liam example question "Why Fruity and not Floral?" and "leaned toward ripe, juicy moments over fragrant ones". These are a comparison in Liam's voice, close to the README's flagged "leaned toward warmth and sweetness over brightness" line. They are not in the brief's list, so I left them unchanged (OT-76).

## Deviations from the brief, and why

1. **`sortOrder` on `/api/coffees/archetypes`:** the brief numbers panels "from `sort_order`", and the payload did not carry it.
2. **`scaleMin` / `scaleMax` on the home facts:** the "0–15" scale was in no public payload, and typing it would break G2.1 / G4.2.
3. **Name hand-off:** the name is written to the quiz's session key as it is typed, and an empty name no longer blocks the quiz button. The quiz's own entry screen asks for the name.
4. **Footer on `/`:** the handoff draws it. The old no-footer reason (`TasteFinderSection`) is gone with it.
5. **`[data-hero]` retired in `Navigation`:** Home passes `floating` and `paper` explicitly. No other page used the contract.
6. **02 menu row stacks below 560px:** as drawn (`nowrap`), the three words need about 430px at the 26px minimum, so they overflowed at 390px.
7. **09's second icon is pause/play of the loop, not "Unmute":** the brief keeps `FilmModal` (the film with sound) on the play icon, so sound already has a door. A pause control for the auto-playing loop is the WCAG 2.2.2 need.
8. **Two G4.4 lines beyond the brief's three** were rewritten (07 card 02 and the 07 foot), as listed above.
9. **Content the handoff has no place for** (pull quote, photo essay with its dead `/essays` link, "months" strip): retired with the old layout and listed as OT-75 ("needs a design"), not silently dropped.
