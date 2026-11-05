# Website handoff — survey (CTO session, 2026-11-04)

Source: `misc/design_documents/website/axis-and-bloom-handoff/` (Camila, 80 files, 31 MB). Seven pages as static HTML: Home ("compromise"), The Bloom (option B), The Axis, Shop all, Find my flavor (options A and B), Sign in, Cart. Shared header/menu/footer copied from `source/axis/index.html`. Media as JPG/MP4 under each page's `media/`. The "handoff document (shared separately)" named in its README is not in the folder.

Read-only survey. Nothing in the repo was changed except this folder. Each brief's Task 0 re-verifies the lines cited here.

## 0. Shared chrome (every page)

Handoff: static (not fixed) top bar, logo mark + wordmark, text links "Sign in" · "Cart (n)" · "Menu"; Menu opens a full-width terracotta field with four numbered links (01 Shop all, 02 The Axis, 03 The Bloom, 04 Find my flavor), Esc/outside-click close. Footer: white, 4 columns (mark · nav · Instagram/Contact/FAQ · newsletter "Your family of taste, in your inbox"), legal line. Fonts: Lato 300/400/700 from Google Fonts (CSS also uses 600). Palette: ink `#ba4c38`, paper `#f1efe5`, white page; family colours identical to `theme.css` (fruity `#ca445f`, floral `#a34b78`, balanced `#d1ac11`, chocolate `#a54c2d`, earthy `#912f2f`).

Current: `Navigation.tsx` fixed 46px bar, icon links, hamburger dialog with focus trap + scroll lock, `GATED_LINKS` under prelaunch (only Find my flavor, cart hidden), ADMIN link for admins, live cart badge from `CartContext`, Profile/Sign out when signed in. `Footer.tsx` 3 columns, real `/privacy` `/terms` links, no FAQ, no newsletter form. `PublicLayout.tsx` hides nav/footer on `/`, `/about`, `/find-my-flavor`, Liam; mounts `NewsletterModal` and `FloatingCart`. `fonts.css` self-hosts Lato (300, 400, 500–600, 700–800) — no Google Fonts needed. Terracotta today `#9a2918`, beige `#f2f1ea`.

Must survive: auth state in the header, admin link, prelaunch gating of links and cart, focus trap/scroll lock/`aria-modal`, live cart count, no-footer routes, `FloatingCart`, real legal links, newsletter form posting through `subscribeNewsletter` (`api.ts:214`).

## 1. Home (`source/homepage-data/`, "compromise")

Sections: 01 five family panels edge-to-edge (photo, "01 — Floral", three words, "Explore Floral" → shop section anchor) with the header floating over · 02 menu row (The Axis / The Bloom / Find My Flavor) · 03 Find my flavor (photo, first-name field, "Take the 7-question quiz", "Have a profile? Sign in") · 03b Why we do this (two paragraphs) · 04 In numbers band (07 Questions · 08 Cupped dimensions · 05 Families · 01 Shape; hover reveals a line) · 05 Know what you like? ("Skip the quiz", featured coffee "This week", `[ $ Price ]`, Add to cart) · 06 Voices (8 survey quotes rotating 7s) · 07 The Axis three step cards (quiz / cupping / dial) · 08 Liam (typed demo exchange, "[ Coffee name ]" placeholder, "Talk to Liam") · 09 Film (hero-loop.mp4, "Where coffee meets AI.", Find my flavor) · 10 footer.

Current `Home.tsx`: hero video + FilmModal, name capture (`localStorage axisbloom.name`), signed-in lifecycle CTA (`renderSignedInCTA`/`renderStageCTA`, stages NEW_NO_QUIZ … LAPSED_SINGLE_ORDER, `getHomepageState`), order-feedback nudge (`OrderFeedbackForm`, 14-day dismiss), `CompanyGiftRedemption`, six-bag collection (incl. Experimental), quotes in code, Liam word reveal, `TasteFinderSection`. `CAMILAS_UPDATES.md` warns twice: redesigns dropped the lifecycle CTA and gift widget.

Must survive: lifecycle CTA block, feedback nudge, gift redemption, name capture, reduced-motion handling, video pause off-screen, `[data-hero]` contract with the nav (or its replacement).

Data in the handoff that is content, not layout: family words (three per family), the four "In numbers" figures, the featured "This week" coffee + price, the 8 quotes, the Liam demo coffee name. Nothing may be typed in (G2.1, G4.2).

## 2. Shop all (`source/shop/`)

Intro "Every coffee we cup." · family menu (All / 5 families, anchors, not sticky) · "Your family is X · from your quiz" + "Your family first" toggle (reorders sections) · five family sections, each: label, name, three words, collection row ("three coffees · $87", "Add the collection"), 3-col card grid. Card: photo 4:3 · "The coffee · Premium ★" + stop label ("2 · Classic") · three words · name · Signature notes · one-line hint · spec list (Best brew, Also good, Milk, Leads in cup, Origin) · "$29 · 12 oz whole bean" · Add to cart. Only Chocolate & Nutty has real content; the rest are `[ placeholders ]`. Hover fills the card with the family colour. No dimension bars, no quantity/size/grind, no sold-out state, no roaster or award name.

Current: `Shop.tsx` is a static mock with no cart (`design/CLAUDE.md`: never touch, to be retired). `/flavor-intelligence` is the real catalog deep-dive (tastings, dimensions, wheel, compare, feedback). The live card is inline in `DialArchetypeSection.tsx:330-400` on `usePositionCardData` + `CardTags`; `PositionCard.tsx` and `bloom/ArchetypeSection.tsx` are dead code. Prices exist on slots (`SlotPrice {weightOz, retailPriceCents}`), collection kind exists in `CartContext`, award is already a customer-safe tag.

NEW data: hint, Also good, Milk, Leads in cup, family three-words, per-coffee photo, collection price with its real discount. Existing: name, stop label, notes, best brew tag, origin, prices, user's archetype (`getUserProfile`/`archetype-order`).

## 3. The Bloom (`source/bloom-b/`, option B)

Header · "The Bloom Dial" + "01 Pick your family · 02 Turn the dial · 03 Meet your coffee" · five family tabs · the field (page tinted in the family colour): left a single SVG flower wheel + range slider with stops; middle the coffee (Premium ★, stop bar, words, name, signature notes, hint, spec list, "Reveal the full profile"); right "Your comfort zone" aside (pill In / At the edge / Outside, sentence, "Unsure? Talk to Liam") · reveal panel (roaster's words left, eight cupping range bars right, Add to cart `[ $ Price ]`, links #breakdown #liam #profile-you) · lineup ("The four Floral coffees", cards turn the dial) · footer. Drag the wheel, slider, ←/→ keys. One wheel shared by all families: petals bloom with `t`, wheel rotates `-t·270°`. No URL state, no ARIA on the wheel, opens on Chocolate & Nutty.

Current `/bloom`: `BloomPage.tsx` + `DialArchetypeSection.tsx` + `BloomDial.tsx` (canvas fill engine, per-archetype dial, `role=slider`, keyboard, doors, step chips). Features the handoff does not show (all must survive): save to flavor memory + silent auto-save (`setDialPosition`), add-to-cart dial event, weight/price selector + unpriced/unavailable states, quick picks (classic + Collection 10% off), `CompareOverlay`, `RevealedPanel` (compatibility badge + why-sentence, TastingNotes, DimensionBars, collaborative wheel), archetype order personalization + YOUR/TO EXPLORE kicker, doors between archetypes, `?archetype=&slot=` deep links (Liam and the quiz use them), Other Categories (Decaf/Half-Caf/Flavored), prelaunch gating, `hasLiamAccess`.

NEW data: family words, hints, spec fields (shared with Shop), comfort-zone thresholds + wording (today's `useCompatibility` sentence is the server-side equivalent), the per-user "YOU" profile values the aside draws. The wheel geometry (petal thresholds/tiers) is a component asset, not content.

## 4. The Axis (`source/axis/`)

Intro bar + chapter nav (01–04) · hero (H1 "Every cup you love has a location…", two leads, origin list of 4 regions with animated dot rows = 7/7/8/7 coffees, "Map last tightened October 24, 2026") · 01 Origin "Two streams meet at a coordinate." (accordion, pull quote, two framed photos "The story" / "The cupping") · 02 Place "How a coffee earns its place." (five colour bands, hover) · 03 Network "No coffee is an island." (logo wheel segmented by family, 3 dashed experimental segments; segment paths scraped from bloom-b) · 04 Readers "One map. Many readers." (wheel + Quiz/Profile/Liam labels; accordion "What Liam can and can't see" = `[ Dana's answer goes here ]`) · Start here (quiz CTA, "Free to take. No commitment.", photo). No fetch anywhere. `axis2.svg`/`axis3.svg` are unused reference art.

Current `TheAxis.tsx` + `AxisMap.tsx`: fetches `/api/axis/stats` (coffeeCount per archetype, connectionCount, experimentalCount, lastTightenedAt, coffeesMapped, bloomNotesThisMonth, positionsRefinedThisQuarter); seeded world map with scroll-driven stages; stage 5 "The loop" with live numbers; `?archetype=` focus param; CTA handoff animation; competitive-safety rule in the header comment (no scales, dimension names, formulas on this page).

Must become data: origin counts (7/7/8/7), last-tightened date, family segment counts if they mean anything. Copy is ~the current copy; placeholders: Liam accordion.

## 5. Find my flavor (`source/flavor-b/` = option B; `standalone/…find-my-flavor.html` = option A)

B: dark photo-per-scene. Entry (photo, "Whose palate are we profiling today?", optional first name, "Begin my profile", "Already have a profile? Sign in", bottom bar) · 7 question scenes (photo, "01 / 07", h2, four text rows A–D, hover indent, selected underlined, auto-advance 420 ms; progress bar replaces the header: name, 7 segments, "Exit ×") · result (photo + orange wash, "{Name}'s family of taste", "Chocolate & Nutty.", paragraph with stop + neighbour coffee, "Turn the dial" + "Ask Liam why"). No back button, no keyboard, no ARIA, no branch/tie screens, no gate, no commerce. A: light, no photos, two columns with a filling wheel, boxed answers, same copy and result.

Current `FlavorQuiz.tsx` (2124 lines): `GET /api/quiz/questions` → `POST /api/quiz/score` → `GET /api/quiz/branch` → `saveQuizResult`; returning-user screen; prelaunch sealed ending; funnel + campaign attribution (`?campaign=` fast start); `?retake=1`, `?result=` preview; wrap ceremony; result hero + `ShareMatchRow` + `PostQuizEmailGate` + `DialArchetypeSection` + Worth exploring + `CompareOverlay`; end action row; back button; `QUESTION_IMAGES`/`Q_HIGHLIGHTS`/`ARCHETYPES` copy still in code (existing violation of G2.1).

Layout only: every question/answer in the handoff is placeholder text (the live questions are SCD2 data). Copy written fresh in the handoff that conflicts with the rules: "No wrong answers. We listen for moments, not flavor words." and "never a flavor to name" (name what we are not doing, G4.4); result line "warmth and sweetness over brightness" (dimension words + comparison).

## 6. Sign in + Cart (`source/account/build.py` → `signin/`, `cart/`)

Sign in: "Welcome back.", email + password, "Forgot your password?", side panel "New here?" → quiz / Bloom. No Google/Apple, no create tab, no states. Current `SignIn.tsx`: Create/Sign In tabs (`?mode=signin`), first/last name on create, Google + Apple, reset-password, `?redirect=` + `?quiz_id` back-to-results; `QrDoor` relies on `?mode=signin&redirect=`.

Cart: full `/cart` page: dynamic headline ("Nothing yet." / "One thing, so far." / …), lines with 96px image, meta "Chocolate & Nutty · 2 · Classic · Premium ★", name, size, −/+ stepper, price, Remove; collection line; empty state; summary Subtotal / Shipping "Calculated at checkout" / Total / Checkout; note "Roasted to order · ships within the week". Current: no `/cart` route; `FloatingCart` drawer with `CartLines` (+ `SubscribeChoice`, `ShippingLine` from `getCheckoutRules`, collection discount, "Sign in to check out"); `CheckoutPage` already shows lines + subscribe + shipping + tax note + Stripe embed; cart state is in-memory only (reload empties it).

## 7. Media

All handoff photos/video are JPG/MP4 in `source/*/media/`. They go through the asset registry (`frontend/src/design/assets.ts`, `optimized()` for photos, `raw()` for the MP4), and the brief must report each `raw/…` upload path for Camila. The 12 `shop-*.jpg` are reused across cards (per-family placeholders, not per-coffee).
