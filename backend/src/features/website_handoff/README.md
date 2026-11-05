# Website handoff — workstream plan

Camila's site handoff (2026-11-04) at `misc/design_documents/website/axis-and-bloom-handoff/` becomes the public site. Survey of what it contains versus what the site does today: `HANDOFF_SURVEY_2026-11-04.md` (read it first; every brief's Task 0 re-verifies its line numbers).

## The merge rule (Dana, 2026-11-04)

"Put your CTO hat and perform a merge between the existing functionality and logic and the design." So, in every brief:

1. **The design decides how it looks.** Layout, type, spacing, colour, motion, copy structure come from the handoff HTML/CSS. Claude Code ports the handoff's CSS values; it does not invent a look.
2. **The code decides what it does.** Every behaviour the live page has today survives (lifecycle CTAs, gate, auth paths, cart, deep links, analytics, prelaunch, admin link, error/loading/empty states). Where the design has no place for one, add it in the design's own language (same type scale, same caps labels, same buttons). A feature is never dropped silently; if it truly cannot fit, it is listed in the closing report as "needs a design", not removed.
3. **The data decides what it says.** Anything the design types in that is content (names, words, counts, prices, quotes, coffee facts, thresholds) comes from the API (G2.1, G4.2). Brand copy (headlines, paragraphs) stays in the component, except where a placeholder `[ … ]` sits: there Claude Code uses the current live copy for that spot, or the data.
4. **Missing states get drawn in the design's style**: empty, loading, error, signed-in, returning user, prelaunch, sold out / unpriced, reduced motion, keyboard and screen reader. The handoff has none of these; the briefs name each one.
5. **Copy register** (G4.4): handoff lines that name what we are not doing are rewritten by Claude Code to the positive form and listed in the closing report for Dana to review in place. Known: "No wrong answers. We listen for moments, not flavor words." · "never a flavor to name" · "Your answers leaned toward warmth and sweetness over brightness" · "Nothing invented, nothing sold to you that the data does not back" · "This isn't a brochure".

## CTO merge decisions (2026-11-04; Dana may overturn any of them before the brief runs)

- **D1 Palette and type.** Handoff tokens site-wide: ink `#ba4c38`, paper `#f1efe5`, white page, family colours unchanged. Lato stays self-hosted (`fonts.css`); no Google Fonts tag. Pages the handoff does not cover (profile, checkout, Liam, about, how-it-works, privacy, terms, admin) only receive the tokens and the new chrome; they are not redesigned.
- **D2 Navigation.** Header and Menu overlay as drawn: 01 Shop all · 02 The Axis · 03 The Bloom · 04 Find my flavor; "Sign in" becomes "Profile · Sign out" when signed in; "Cart (n)" is live and links to `/cart`; ADMIN appears for admins; prelaunch trims to the gated set as today. Flavor Intelligence leaves the menu but the route stays (see D4).
- **D3 Cart.** Both: the drawer stays (add-to-cart opens it as today); `/cart` is added as the page the header links to, built on `CartLines` / `SubscribeChoice` / `ShippingLine` / `useCart`.
- **D4 Shop all.** Replaces `/shop` (`Shop.tsx` retired at last). `/flavor-intelligence` stays as the coffee deep-dive, reached from a card's "Full profile" link and from the reveal panel, not from the menu. `/coffees` redirect unchanged.
- **D5 Families shown.** The five archetypes as drawn (`coffee_archetype.is_archetype = true`, in `sort_order`). Experimental coffees and the categories (Decaf, Half-Caf, Flavored) keep their current surfaces (Other Categories on The Bloom, Liam, doors); Shop all gets one "Other" section below the five families for them, in the family-section style. Order of sections for a signed-in customer: their family first ("Your family first" toggle, default on when a family is known).
- **D6 Quiz.** Option B (photo per scene; it is the one with a `source/` folder). Questions, answers, scoring and branch stay data; the handoff question text is layout only. Add: back button, keyboard/ARIA, the branch and tie screens, the returning-user screen, the prelaunch sealed ending, loading/error, in B's style. The result scene is the hero only; the gate, dial section with cart, Worth exploring, share row and end action row follow it, restyled.
- **D7 The Axis.** Handoff chapters replace the world map and scroll stages. Live numbers stay: origin counts per region and "Map last tightened" from `/api/axis/stats`; the stage-5 stats line (Bloom Notes this month, positions refined) moves into chapter 04 Readers as its last line. The Liam accordion uses the current live Liam copy. `?archetype=` focus highlights that family's band in chapter 02.
- **D8 Sign in.** Handoff layout, with everything the current page does kept inside it: Create / Sign In as two tabs in the design's caps style (`?mode=signin` honoured), first and last name on create, Google and Apple buttons under the form, "Forgot your password?" wired to the reset endpoint, `?redirect=` and `?quiz_id` behaviour, error and sent states. The side panel "New here?" links the quiz and The Bloom as drawn.
- **D9 New content fields.** The handoff shows per coffee: a one-line hint, Also good (brew), Milk, Leads in cup, Origin; per family: three words. These become data in the coffee presentation domain (brief 2), read through one view, with the roastery portal answers as the first source where they exist (best / also-good brew already live in `roastery_portal_response_brew`). Where no source exists yet the field is NULL and the card omits the row (never a placeholder).
- **D10 Numbers and quotes on Home.** The "In numbers" band is computed (current quiz question count, cupping dimension count, archetype count); the survey quotes live in a seeded lookup table, not in code; "This week" featured coffee is a `commerce_parameter`-style parameter pointing at a slot, price from `coffee_slot_price`.
- **D11 Media.** Every handoff photo and the MP4 go through `frontend/src/design/assets.ts` (`optimized()` / `raw()`); each brief reports the exact `raw/…` upload paths for Camila. No file is committed under `frontend/src/design/IMAGES`.
- **D12 Premium ★.** It is the existing award tag (`CardTags`), rendered in the handoff's "Premium ★" style; no award name ever reaches the customer (G4.5).
- **D13 Prices and shipping copy.** "$29", "$87", "Shipping included", "Calculated at checkout" are never typed: price from the pricing tables, shipping line from `getCheckoutRules()`.
- **D14 No roasting or delivery promises (Dana, 2026-11-04).** "Roasted to order", "ships within a week of roast", "ships within the week" and any freshness or timing claim are removed wherever the handoff has them (Home 05, Shop intro, Cart note). The only fulfilment statements the customer sees are facts from `order_event` / `v_order_status`: the order was sent to the roastery, and when it shipped (with the date). Saying that partner roasteries roast and ship is still allowed (G4.5); a time or freshness promise is not.

## Brief plan (run in this order, one at a time, G1.9)

| # | File | Scope | Size | Model |
|---|---|---|---|---|
| 1 | `CLAUDE_CODE_PROMPT_WEBSITE_1_CHROME.md` | Tokens, header + Menu overlay, footer, shared primitives, asset keys | M | cheaper |
| 2 | `CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md` | Family words, coffee presentation fields, home quotes + facts + featured slot, read views and endpoints | M | cheaper, catalog discipline |
| 3 | `CLAUDE_CODE_PROMPT_WEBSITE_3_HOME.md` | Homepage on the new chrome, lifecycle/gift/feedback preserved | M | cheaper |
| 4 | `CLAUDE_CODE_PROMPT_WEBSITE_4_SHOP_ALL.md` | `/shop` rebuilt, `ShopCoffeeCard`, collection row, Shop.tsx retired | M | cheaper |
| 5 | `CLAUDE_CODE_PROMPT_WEBSITE_5_THE_BLOOM.md` | Flower wheel dial, field layout variant, comfort zone, all dial features preserved | L | strongest |
| 6 | `CLAUDE_CODE_PROMPT_WEBSITE_6_THE_AXIS.md` | Chapters rebuilt, live numbers kept, map retired | M | cheaper |
| 7A | `CLAUDE_CODE_PROMPT_WEBSITE_7A_FIND_MY_FLAVOR_ENTRY_AND_QUESTIONS.md` | Find my flavor: entry + question scenes, progress bar, back, keyboard, question image as data | M | cheaper |
| 7B | `CLAUDE_CODE_PROMPT_WEBSITE_7B_FIND_MY_FLAVOR_RESULT.md` | Find my flavor: result scene, archetype copy out of code, gate/dial/share preserved | M | cheaper |
| 8 | `CLAUDE_CODE_PROMPT_WEBSITE_8_SIGN_IN_AND_CART.md` | Sign in page, Cart page (`/cart`), checkout restyle | M | cheaper |

Brief 8 only depends on 1 and can run any time after it. 3–7 depend on 1 and 2.

## Data gaps (every field the handoff shows that has no source today, and where it goes)

| Handoff field | Surface | Source today | Goes to | Brief |
|---|---|---|---|---|
| Three words per family ("Bright · Fragrant · Delicate") | Home, Shop, Bloom, quiz result | none | `coffee_archetype.customer_words text[]` | 2 |
| One-line hint per coffee | Shop, Bloom | none (check `v_roastery_portal_coffee_hint` first) | `coffee_presentation.hint` | 2 |
| Milk recommendation | Shop, Bloom | none unless the portal asks it | `coffee_presentation.milk_recommendation_id` → lookup `coffee_milk_recommendation` | 2 |
| Best brew / Also good | Shop, Bloom | `roastery_portal_response_brew` | read through `v_coffee_card` | 2 |
| Leads in cup | Shop, Bloom | derivable from `v_coffee_dimension_range` + `coffee_dimensions` | derived in `v_coffee_card` | 2 |
| Origin | Shop, Bloom | `coffees.origin_region_id` → `lookup_value` | `v_coffee_card` | 2 |
| Premium ★ | Shop, Bloom, Cart | award flag behind `CardTags` | `v_coffee_card.has_award` (boolean) | 2 |
| Per-coffee photo | Shop, Bloom, Cart | none | `coffee_presentation.photo_asset_key` (NULL until Camila supplies one; family photo meanwhile) | 2 |
| Collection price per family | Shop | discount parameter exists; no per-family total endpoint | computed in `GET /api/coffees/cards` | 2 |
| In numbers (07 / 08 / 05) | Home | counts exist in `quiz_question`, `coffee_dimensions`, `coffee_archetype` | computed in `GET /api/home/content` | 2 |
| Survey quotes | Home | in code (`Home.tsx QUOTES`) | `marketing_home_quote` | 2 |
| "This week" featured coffee | Home | none | parameter row `home_featured_slot` | 2 |
| Question photo | Quiz | in code (`QUESTION_IMAGES`) | `quiz_question.image_asset_key` | 7A |
| Archetype description / why-you-match | Quiz result | in code (`ARCHETYPES`) | `coffee_archetype.description` (exists); `match_reason` only if no source | 7B |
| Comfort-zone pill thresholds | Bloom | in handoff JS | parameter row | 5 |
| Coffees per origin region | Axis | none | `v_axis_origin_region_count` or an extension of `/api/axis/stats` | 6 |
| Order sent to roastery / shipped on | Profile orders, cart note replaced | `order_event`, `v_order_status` | read as is | 8 (nothing new) |
| Cart quantity | Cart | add-by-duplicate only | `CartContext.setQuantity` (frontend state) | 8 |

Nothing in this table is typed into a component. Each brief's Task 0 re-checks `CATALOG.md` before creating the object (G2.4).

## Pages not in the handoff (2026-11-04)

Customer-facing routes with no design in Camila's folder. Briefs 1 and 8 give them the tokens and the new chrome; none is redesigned by this workstream.

| Page | Route | Status |
|---|---|---|
| Profile | `/profile` | tokens + chrome (brief 1); needs a design from Camila |
| Liam chat | `/sommelier` | tokens + chrome; needs a design |
| Checkout, return | `/checkout`, `/checkout/return` | restyled in brief 8, logic untouched |
| Flavor Intelligence, coffee story | `/flavor-intelligence`, `/coffee/:id/story` | kept as the "Full profile" target; tokens only |
| About, How it works | `/about`, `/how-it-works` | not in the new menu; decision pending: design them or retire with redirects to `/` and `/the-axis` |
| Privacy, Terms | `/privacy`, `/terms` | tokens only |
| Crawl, QR door, Join household | `/crawl`, `/b`, `/join-household` | tokens only |
| Pre-launch curtain | `/` while gated | untouched |

Partner (roastery portal) and admin pages are out of scope.

## Open with Dana

- The README in the handoff names "the handoff document (shared separately)" that describes every page, interaction and data structure. It is not in the folder. If Camila has it, drop it in the handoff folder; briefs will cite it.
- The handoff photos are reused across cards (per-family, not per-coffee). Per-coffee photos are a later asset task for Camila, not a blocker: the card uses the family photo until a coffee photo key exists.
