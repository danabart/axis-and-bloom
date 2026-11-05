# Closing report — Website 4 (Shop all, `/shop`)

Brief: `CLAUDE_CODE_PROMPT_WEBSITE_4_SHOP_ALL.md` · Run: 2026-11-05 · Mode: test, then push (G1.6).

## Task 0 — findings (read-only, written before any change)

### 0.1 `Shop.tsx` (427 lines): imports, and the links into `/shop`

- **Code imports:**
  - `react`, `motion/react` and `react-router`: shared.
  - `TasteFinderSection`: still imported by `About.tsx` and `HowItWorks.tsx`, so it stays.
- **Asset imports:** 24 PNGs under `frontend/src/design/IMAGES/`, all git-tracked, about 90 MB. Six bag mock-ups (`bags/new bags mock up/*transp.png`) and 18 June photos (`photos/june2026/WEBCUT*`). **Only `Shop.tsx` imports them.** Retiring the page removes them from the bundle. The files are Camila's design originals in a 72-photo archive folder, not code, so this brief leaves them on disk.
- **Links into `/shop`, all kept:**
  - `App.tsx` route (`PrelaunchGate`).
  - `Navigation` menu "01 Shop all"; `AdminLayout` "Shop".
  - `Home.tsx`:
    - The lifecycle CTAs: Shop your matches, Reorder, See what's new, Shop again.
    - "Shop all coffees".
    - The family panels `/shop#<code>`, with codes `floral`, `fruity`, `balanced_sweet`, `chocolate_nutty`, `earthy`. Each family section's `id` is its code.
  - `Profile.tsx:705` "Explore the Shop"; `TasteFinderSection` footer link.
  - No backend email template or `QrDoor` links `/shop` (grep).

### 0.2 The live card (`DialArchetypeSection.tsx` 330–400), its data and the cart

- **The card:** name, `CardTags`, teaser, status (Coming soon / Unpriced / Temporarily unavailable), weight chips when more than one weight is available, "shipping included", "Add to cart" (hidden in prelaunch), Compare, Save.
- **`usePositionCardData(slot, archetype, isRevealed)`** fetches `/content` (tags), `/hops`, `/flavor-wheel` (teaser), and `/api/shop/slot-availability` per weight. From those it derives `availableWeights`, `selectedWeight`, `isUnpriced` and `effectivelyActive`.
- **Availability** is `resolveBlendForSlot`: can a roaster fulfil this slot at this weight now. The `/cards` payload does not carry it.
- **Cart and sync:**
  - The dial item is `{kind:'dial', archetype, archetypeLabel, dialSortOrder, weightOz, platformName, retailPriceCents, qty:1}`.
  - The sync is `setDialPosition(archetype, dialSortOrder, {trigger:'add_to_cart', source, coffeeId})` (`lib/api.ts`), called after `addToCart` for any `user`.
  - Both are built inline in `DialArchetypeSection`, `ArchetypeSection` and (since Website 3) `Home`.
- **Decision (one source):**
  - The Shop card reads its presentation (notes, brew, milk, leads, origin, hint, photo, award flag, prices) from `/api/coffees/cards`, which supersedes the per-card `/content` and `/flavor-wheel` fetches.
  - The availability and weight logic moves out of `usePositionCardData` into a shared `useSlotAvailability(slot, archetype)`, used by both hooks, so the rule lives once.
  - The dial and collection item builders and the add-to-cart sync move into `bloom/cartItems.ts`, used by `DialArchetypeSection`, `Home` and the Shop card.

### 0.3 `/api/coffees/cards` (prod, 2026-11-05) against the handoff card

| Handoff | Payload | Prod today |
|---|---|---|
| photo | `photoKey` | absent on all 20 → family photo |
| "The coffee" · Premium ★ | `hasAward` (boolean only, brief 2) | true on 1 (Coado) |
| stop label "2 · Classic" | `dialSortOrder` · `positionLabel` | all |
| words | family `customerWords` | all 5 |
| name | `platformName` (slot name) | all 20 |
| Signature notes | `signatureNotes` | 7 coffees |
| hint | `hint` | **absent on all** |
| Best brew / Also good | `bestBrew` / `alsoGood` | 7 / 7 |
| Milk | `milk` | 6 (one coffee has none) |
| Leads in cup | `leadsInCup` | 7 |
| Origin | `originRegion` | **absent on all** (OT-71) |
| "$29 · 12 oz whole bean" | `prices[]` (`isAnchor`) | 7 coffees priced, one size each |

- **Families:** 20 slots, 7 with a coffee; the other 13 have `isActive:false`, which is the "Coming soon" state.
- **Collection:** `collectionOffer` is set only for Chocolate & Nutty (`{memberCount 3, sumCents 9000, discountedCents 8100}`) and null elsewhere, so only Chocolate & Nutty gets a collection row.
- **`other.cards`:** coffees 2930 and 2909, both Decaf, both `platformName: null` and unpriced. Under OT-70 neither shows, so **the Other section is empty on prod today** and is not rendered.

### 0.4 The collection item

`DialArchetypeSection.handleCollectionAdd` builds `{kind:'collection', archetype, archetypeLabel, memberCount, retailPriceCents: offer.discountedCents, undiscountedPriceCents: offer.sumCents, qty:1}` from the payload's `collectionOffer`, with no client-side math. This becomes `collectionCartItem(family)` in `cartItems.ts`, and the "Add the collection ↗" row calls it.

### 0.5 Deep link to the full profile

`FlavorIntelligencePage` reads `?archetype=&slot=` (slot coffees), `?coffee=` (legacy, redirected) and `?directCoffee=<id>` (category coffees). Chosen:
- **A slot card:** `/flavor-intelligence?archetype=<code>&slot=<dialSortOrder>`, the same link `RevealedPanel` uses.
- **An Other card:** `/flavor-intelligence?directCoffee=<id>`, as `BloomPage` uses.

`/coffee/:id/story` is the story page, not the profile.

### 0.6 OT-70: a customer name for a category coffee (CATALOG.md check, G2.4)

- **`coffee_category_assignment`** (CATALOG.md): `id`, `coffee_id`, `category_id`, `assigned_at`. **There is no customer-name column.** Writer: `catalogService.applyCategoryCodes` (via `createCoffee`/`updateCoffee`), plus seed.
- **Other objects considered:**
  - `coffee_category`: per category, not per coffee.
  - `coffee_dial_slot.slot_name`: the name of a slot role, and a category coffee has no slot role.
  - `coffee_presentation` (brief 2): one row per coffee, A&B's editorial layer for a card. It is not the name of a role; the decision is that the name lives with the role.
  - `coffees.name`: the roaster's own name, never shown (G4.5).
- None fits, so per the decision `coffee_category_assignment.customer_name text` is added (NULL seed).
  - Written by a new `catalogService.setCategoryCustomerName`.
  - `applyCategoryCodes` deletes only the tags that are removed and inserts the rest with `ON CONFLICT DO NOTHING`, so a kept tag keeps its name.
  - Read through the existing declared reader, `catalogReads.getCategoryCoffees`, into `getOtherCategoryCoffees`. That is the one function behind both `/api/coffees/other-categories` and the `/cards` "other" list, so `v_coffee_card` is not widened.
- **Found:** `/api/coffees/other-categories` (`getOtherCategoryCoffees`) still uses `displayName: homeSlot?.slot_name ?? coffee.name`. That is the raw-name fallback the decision forbids, and BloomPage's Other Categories and Flavor Intelligence render it today.
  - The rule becomes: the category's `customer_name`, else the coffee's home slot name (also a customer-facing name), else the coffee is not listed.
- **Admin door:** without one, Dana could not enter a name (G1.10). The coffee Edit modal's "Customer card" block gains one name field per category tag, through `PUT /api/admin/catalog/coffees/:id/category-name`.

### 0.7 Ordering, "your family", sticky menu

- **Ordering:** `GET /api/coffees/archetype-order?archetype=<code>` puts the customer's family first, then its neighbours, then the rest. Without a match it falls back to `sort_order`, and experimental is excluded. Signed in, the family comes from `getUserProfile().archetype` (`id` = code, `name`), as `BloomPage` reads it.
- **Sticky menu:** `Shop.tsx` keeps its family nav `position: sticky; top: 80` (the old fixed bar). The header is static since Website 1, so the new menu sticks at `top: 0` on desktop.
- **"Other":** D5 puts experimental coffees and the categories together in "Other", and `/cards` "other" already lists decaf, half_caf, flavored and experimental. The section shows that list.

### 0.8 Handoff source (`source/shop/build.py`, `index.html`)

- **Intro and menu:** intro (`.shop-intro`, `.shop-h`, `.shop-lead`), `.fmenu` (All + families), `.foryou-line` with a `.toggle[aria-pressed]`.
- **Family section:** `.family` with `.fam-head` (5fr/7fr; label "0N — Family of taste" or "Your family", `.fam-name` in `--c`, words; `.collection` row), then `.grid` (3 columns, 2 at ≤1000px, 1 at ≤560px).
- **`.card`:** 1px ink border; hover fills with `--c` and text `--ink` (paper on every plate except Balanced, which uses `#912f2f` on `#d1ac11`).
  - Image 4:3.
  - "The coffee · Premium ★" plus the stop label, words, name `.cn`, "Signature notes" (`titled`), `.sig`, `.hint`.
  - `dl.spec` (Best brew, Also good, Milk, Leads in cup, Origin).
  - `.foot` "$29 · 12 oz whole bean" + "Add to cart ↗".
- **Family photos as the generator assigns them** (first per family):
  - floral `shop-DSC_3886.jpg`, fruity `shop-DSC_3942.jpg`, balanced `shop-IMG_0589.jpg`, chocolate `shop-DSC_3988.jpg`, earthy `shop-IMG_0489.jpg`.
  - The generator uses all 12 `shop-*` photos on family cards, so "Other" takes `shop-IMG_0726.jpg` (floral's third).
- The `scan-*.jpg` files and the `.fam-scan` class are present but unused by the generator.

### Verdict

Nothing contradicts the brief, so the build goes ahead. Choices made:
- Presentation from `/cards`, with availability through a shared hook extracted from `usePositionCardData`.
- Cart builders shared.
- The OT-70 column on `coffee_category_assignment` with a writer and an admin field, and the raw-name fallback removed from `getOtherCategoryCoffees`.
- Other = the `/cards` other list (D5).
- The Shop image files are left on disk.

## What was built

- **`/shop` = `components/shop/ShopAll.tsx`** (still behind `PrelaunchGate`). `Shop.tsx` is deleted.
  - **Intro:** "Shop all" / "Every coffee we cup." and the lead "{n} families, a handful of coffees in each. Every one cupped on {d} dimensions, from partner roasteries."
    - {n} is the family count from the payload; {d} is `facts.dimensions` from `/api/home/content`.
    - The handoff's "roasted to order by partner roasteries" is gone (D14).
  - **Family menu:** All, the five families and Other (when listed), as anchors. Scroll-spy uses an IntersectionObserver; the menu is sticky at `top: 0` on desktop (≥900px).
  - **"For you" line:** with a known family, "Your family is {name} · from your quiz" plus the "Your family first" toggle (default on, `localStorage ab.shop.familyFirst`). Otherwise "Find your family first →" to the quiz.
  - **Family sections:** in `sort_order`, or the archetype-order endpoint's order while the toggle is on. Each section has:
    - `id` = archetype code, so `/shop#<code>` lands, including after the data loads.
    - Label "0N — Family of taste" / "Your family", the name in the family colour, and `customerWords`.
    - The collection row "The collection · {memberCount} coffees · {discounted price}" with "Add the collection ↗" (only when the payload has an offer, never while gated).
    - The card grid at 3 / 2 / 1 columns (handoff breakpoints 1000 / 560).
  - **Other:** the named category coffees. The heading is their category labels. No collection row, no words.
- **`ShopCoffeeCard`** (one presentational card) with two wrappers feeding it:
  - `SlotShopCard`: availability from the shared `useSlotAvailability`, add = `dialCartItem` + `syncDialAddToCart(…, 'shop')`.
  - `OtherShopCard`: payload prices, add = `directCartItem`.
  - **Card layout:**
    - Photo 4:3 (`photo_asset_key` via `optimizedAsset`, else the family photo, else the live fallback).
    - "The coffee · Premium ★" (from `hasAward`) and the stop label; words; name; "Signature notes"; hint.
    - `dl` with only the rows present.
    - Footer "{price} · {oz} oz whole bean" with weight chips when there is more than one size; "Add to cart ↗"; "Full profile ↗".
  - **States:**
    - "Price coming": unpriced.
    - "Coming soon": tinted; no coffee on the slot, or no roaster can fill it now.
    - Prelaunch: no price, no cart link.
  - Hover and `:focus-within` fill the card with the family colour, text in the family's `plateInk`.
- **Shared, not forked:**
  - `bloom/cartItems.ts` (dial, collection and direct items, and the add-to-cart dial sync) is now the one place these shapes are built. `DialArchetypeSection`, `ArchetypeSection` and `Home` call it.
  - `bloom/useSlotAvailability.ts` holds the availability/unpriced/active rule, and `usePositionCardData` uses it.
- **OT-70, backend:**
  - Column `coffee_category_assignment.customer_name` (comment, NULL seed).
  - The one writer `catalogService.setCategoryCustomerName`: trims, blank clears, refuses a category the coffee does not carry, logs `catalog_change`, idempotent.
  - Admin `PUT /coffees/:id/category-name`; the fields sit in the coffee Edit modal's Customer card.
  - The read is `catalogReads.getCategoryCoffees`. `getOtherCategoryCoffees` (behind both `/other-categories` and `/cards` "other") names the coffee by `customer_name`, else its home slot name; otherwise it drops the coffee. **The raw `coffees.name` fallback is gone, for The Bloom's Other Categories too.**
- **Part B2 (OT-76):** Home's Liam answer is now "Your answers leaned toward ripe, juicy moments. On the dial…". The customer's question stays.
- **Assets (Part A):** `shopAssets` keys and `optimizedAsset(path)`. Until the uploads land, family photos fall back to `archetypeAssets[slug].sm1` and Other to `lifestyleAssets.coffee15`.

## Upload paths for Camila (Task 0.5)

Upload to `gs://axis-bloom-assets/`. The image pipeline writes the optimized copies, and no deploy is needed.

| Handoff file (`source/shop/media/`) | Upload to | Key |
|---|---|---|
| `shop-DSC_3886.jpg` | `raw/shop/family-floral.jpg` | `shopAssets.family.floral` |
| `shop-DSC_3942.jpg` | `raw/shop/family-fruity.jpg` | `shopAssets.family.fruity` |
| `shop-IMG_0589.jpg` | `raw/shop/family-balanced-sweet.jpg` | `shopAssets.family['balanced-sweet']` |
| `shop-DSC_3988.jpg` | `raw/shop/family-chocolate-nutty.jpg` | `shopAssets.family['chocolate-nutty']` |
| `shop-IMG_0489.jpg` | `raw/shop/family-spicy-earthy.jpg` | `shopAssets.family['spicy-earthy']` |
| `shop-IMG_0726.jpg` | `raw/shop/other.jpg` | `shopAssets.other` |
| one photo per coffee (later, OT-77) | `raw/shop/coffee/<name>.jpg` | photo key `shop/coffee/<name>` in admin |

## Deviations and choices, and why

1. **One source per card:** presentation from `/cards`, plus availability from a hook extracted out of `usePositionCardData`. The dial card and the Shop card share the rule, and the Shop page does not fetch `/content` + `/flavor-wheel` + `/hops` for 20 cards.
2. **OT-70 read path:** `catalogReads.getCategoryCoffees`, already a declared reader of the table, instead of widening `v_coffee_card`. The brief allowed either. The home slot name stays as the second source; it is a customer-facing slot name, not the raw coffee name.
3. **`/other-categories` follows the same rule:** a category coffee with no customer name also leaves The Bloom's Other Categories. On prod today that is both decaf coffees (2909, 2930) until names are entered in admin.
4. **Admin field for the name:** without it the new column would need manual SQL (G1.10).
5. **Other = the `/cards` "other" list** (decaf, half_caf, flavored and experimental), following D5. Part B's list names only the first three; on prod no experimental-tagged coffee exists today.
6. **Lead copy:** the dimension count comes from `/api/home/content` facts, the same numbers Home shows.
7. **Premium ★** is the handoff's label on `hasAward`. Brief 2 kept the award as a boolean, so the lookup label "Award-winning, per the roaster" never reaches the page.
8. **Shop.tsx's 24 images** are not deleted: they are Camila's originals. They simply stop being bundled.
9. **"Coming soon" covers "Temporarily unavailable" too:** the brief maps both unavailable and coming soon to "Coming soon".
10. **Only the family menu is sticky,** not the "for you" line, which keeps the stuck bar short. This matches the old Shop's sticky nav.
