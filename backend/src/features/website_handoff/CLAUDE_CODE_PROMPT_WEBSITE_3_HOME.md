# Brief: Website 3 — Homepage ("compromise")

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** briefs 1 (chrome) and 2 (`/api/home/content`, `customer_words`).

Read first: `README.md` (merge rule, D1, D2, D5, D10, D11, D13), `HANDOFF_SURVEY_2026-11-04.md` §1, `CAMILAS_UPDATES.md` top warning (lifecycle CTA and gift widget were dropped twice by redesigns), `backend/src/features/customer_life_cycle/`, `DEVELOPMENT_GUARDRAILS.md`.

Design source: `misc/design_documents/website/axis-and-bloom-handoff/source/homepage-data/index.html` (+ its `media/`). `homepage-ORIGINAL/` is reference only.

## Goal

`/` is the handoff homepage, section for section, on the new chrome, with every behaviour the current `Home.tsx` has kept and placed in the design's language.

**Decisions already made:** the handoff order of sections (01 families → 02 menu row → 03 Find my flavor → 03b Why → 04 In numbers → 05 Know what you like → 06 Voices → 07 The Axis steps → 08 Liam → 09 Film → footer) · five family panels (D5) · numbers and quotes from the API (D10) · featured coffee from the parameter, price from pricing (D13) · media via the registry (D11).

**Guardrails.** G4.1 reuse (`Navigation floating`, `Footer`, chrome primitives, `OrderFeedbackForm`, `CompanyGiftRedemption`, `useCart`, `FilmModal`) · G4.2 nothing typed in (words, counts, quotes, featured coffee, price) · G4.3 tsc clean, verified live · G4.4 positive register (rewrite the two flagged lines) · G4.6 `/` stays behind the curtain via `HomeOrPrelaunch` · G1.6. No schema. Mode: test. STOP: none.

## Task 0 — verify first (findings into `CLOSING_REPORT_3.md`)

1. Read `Home.tsx` fully. List: `getHomepageState` stages and the CTA each renders; `OrderFeedbackForm` nudge + 14-day dismiss; `CompanyGiftRedemption` + `refreshHomepageState`; name capture (`localStorage axisbloom.name`) and how `/find-my-flavor` reads it (`sessionStorage axisBloomCustomerName`? report the mismatch if any); `TasteFinderSection`; `FilmModal`; video pause/loop handling; reduced motion.
2. Read the handoff page: sections, the three scripts (quotes rotation, Liam typing, menu), CSS classes per section.
3. Confirm `/api/home/content` and `customer_words` from brief 2 are live; confirm `/api/coffees/archetypes` order.
4. Confirm the asset registry keys needed and whether any handoff photo duplicates an existing bucket object (the five family photos may already exist as `archetypeAssets.*.hero`; compare by eye, report).

## Task 0.5 — Dana's manual steps

Upload the handoff media to the bucket at the `raw/…` paths Part A reports (Camila's workflow). The page falls back to the existing registry images until then; this is not a pause point.

## Part A — assets

Add registry keys (`frontend/src/design/assets.ts`): `homeAssets.family.{floral,fruity,balanced-sweet,chocolate-nutty,spicy-earthy}` (optimized), `homeAssets.axisQuiz`, `homeAssets.axisCupping`, `homeAssets.pour`, `homeAssets.window`, `videoAssets.homeLoop` + `homeAssets.heroPoster` (raw). Report each `raw/` path in the closing report.

## Part B — the page, section by section (handoff look, current behaviour)

- **01 Families.** Five `<a>` panels from `getArchetypes()` filtered `is_archetype`, in `sort_order`; number from `sort_order`, name, `customer_words`, photo from the registry key by slug, "Explore {name}" → `/shop#{code}`. Header floats over (`Navigation floating`). Prelaunch: links point where the gated set allows (quiz) exactly as today's gating.
- **02 Menu row.** The Axis / The Bloom / Find My Flavor as `Link`s (`/the-axis`, `/bloom`, `/find-my-flavor`).
- **03 Find my flavor.** Photo + "Ready to see your shape?" + first-name field + "Take the {n}-question quiz" with `n` = `facts.questions` (D15: 6 today; the lead's "Seven questions" becomes "{n} questions" the same way) + "Have a profile? Sign in". Name capture kept (same storage key the quiz reads; fix the mismatch Task 0 found so the quiz entry is prefilled). **Signed-in / lifecycle:** this section is where `renderSignedInCTA()` lives: when `homepageState` has a stage other than `NEW_NO_QUIZ`, the h2/body/button are replaced by the stage's headline, body and primary link (same texts as today), rendered with the design's h2 and `Btn`; the feedback nudge (`OrderFeedbackForm` + "Not now") renders above the headline in a `Frame`-less column; `CompanyGiftRedemption` renders directly under this section as its own `Wrap` block. These three are the regressions `CAMILAS_UPDATES.md` warns about; tests cover them (Part D).
- **03b Why.** Copy as drawn.
- **04 In numbers.** `facts.questions`, `facts.dimensions`, `facts.families` zero-padded ("07"); the fourth tile "01 Shape that is yours" is copy. Hover lines as drawn; on touch the line is visible.
- **05 Know what you like.** Copy as drawn, except the lead's "roasted to order by partner roasteries" becomes "from partner roasteries" (D14); the "Five families" number from `facts.families`; figure = `featured` card from `/api/home/content`: family number + name, platform name, signature notes line, `{weight} oz whole bean · {price}` from the pricing payload, "Add to cart ↗" → `useCart().addToCart` with the same item shape the dial card builds (`kind: 'dial'`), and the dial-event sync the dial card performs for signed-in users (reuse that function; do not fork). Hidden entirely under prelaunch (as cart is).
- **06 Voices.** `quotes` from the API; rotation 7s/1.4s fade, pause on hover, reduced motion = first quote static.
- **07 The Axis steps.** Three cards as drawn ("Answer seven questions" → the computed count, D15); "About three minutes", "Eight dimensions · 0–15" use `facts.dimensions` and the scale labels from the existing dimension payload (Task 0 names it); link → `/the-axis`.
- **08 Liam.** Typed exchange as drawn, playing once on scroll-into-view, then looping; reduced motion = static. Replace "[ Coffee name ]" with the `featured` coffee's platform name? No: the example is Fruity. Use the platform name of the Fruity family's gentle-end slot from `/api/coffees/archetypes` (first slot by sort order); if none, drop the clause "next to …". "Talk to Liam" → `/sommelier`, hidden when `!hasLiamAccess` or gated; signed-out visitors see the same button leading to `/sign-in?redirect=/sommelier`.
- **09 Film.** `videoAssets.homeLoop` with poster; "Where coffee meets AI." + "Find my flavor". Keep `FilmModal` on the play icon button, keep pause-off-screen and the rAF loop fix. The "[ Video placeholder ]" caps label is removed.
- **Retired from Home:** the six-bag collection grid, `TasteFinderSection` (report whether any other page imports it; if none, leave the file, note in OPEN_TASKS), `StripesDivider`, the Liam word reveal. Nothing else.

## Part C — copy register

Rewrite to positive form and list in the closing report: "Nothing invented, nothing sold to you that the data does not back." · "We never ask you to name a flavor or rate acidity, because almost nobody can." · "Never a flavor to name." Remove every roasting/timing promise (D14). Keep everything else as drawn.

## Part D — tests

vitest with mocked API: for each `stageCode` the section-03 headline/link match the current texts; the feedback nudge appears when `pendingFeedback` and not dismissed; `CompanyGiftRedemption` is mounted; facts render from the payload; featured add-to-cart calls `addToCart` with the dial item shape; gated mode hides the featured card's cart link and Liam.

## Acceptance

Live, signed out and signed in (`?preview=true`), 390/1280 screenshots of every section; one signed-in account per lifecycle stage is not available, so the stage CTAs are covered by the tests plus one live screenshot of the signed-in state; Lighthouse a11y ≥ 90.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (lifecycle CTA, feedback nudge, gift widget, name prefill, prelaunch hides cart/Liam), `OPEN_TASKS.md` (real film when ready; admin editor for quotes), `CLOSING_REPORT_3.md` with the `raw/` upload paths.

## Do not

- Do not drop or move the lifecycle CTA, the feedback nudge or the gift widget; do not re-implement `OrderFeedbackForm`.
- Do not type a number, a word triple, a quote, a coffee name or a price.
- Do not add a route or schema.
