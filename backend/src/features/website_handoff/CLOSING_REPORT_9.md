# Closing report — Website 9: Dana's review fixes, site audit, close-out

**Status: shipped** (`WHAT_WE_BUILT.md` #261). Task 0 stopped as the brief says; Dana decided Q1–Q5 the same day (recorded below), and Parts A–D ran through to push, deploy, `catalog:md`, the startup log and the production smoke. Evidence at the end.

Task 0 found one fact that changes D16: **production has no family adjacency today.** `GET /api/axis/adjacency` returns `{"adjacency":{}}`, so `v_coffee_archetype_adjacency` has no pairs. A relationship read from adjacency alone would label all four of Dana's other families "Outside your comfort zone". That's the Q1 decision below. It is not a contradiction that stops the brief (D16 already asks Task 0 to propose the source), but the fix depends on the answer.

Read for Task 0:
- `DEVELOPMENT_GUARDRAILS.md`, `CLAUDE.md`, the brief;
- `README.md` (the merge rule, D5, D14, D15);
- `CLOSING_REPORT_3/5/7B/8.md`, `CATALOG.md` (`archetype_relationship`, `v_coffee_archetype_adjacency`);
- the code: `BloomPage.tsx`, `bloom/wheel/FlowerWheel.tsx`, `bloom/dial/BloomDial.tsx`, `bloom/field/DialFieldLayout.tsx` + `bloomField.css`, `DialArchetypeSection.tsx`, `shop/ShopAll.tsx`, `shop/ShopCoffeeCard.tsx`, `Home.tsx`, `coffee-info/useCompatibility.tsx` + `archetypeAdjacency.ts`, `services/catalogReads.ts`, `services/compatibilityReads.ts`, `routes/axis.ts`, `routes/users.ts`, `FlavorQuiz.tsx`.

How the evidence was gathered:
- **Signed out:** local Vite :5179 → backend on `axisandbloom_test`, headless Chromium at 1280 and 390 (`scratchpad/audit9.mjs`, `probe9*.mjs`).
- **Production catalogue, read-only:** a second local Vite :5180 proxied to the production API, with every non-GET request aborted in the browser, so nothing was written.
- **Signed in:** production in Dana's Chrome through the extension (Home worked this time).
  - Her window is 2195 CSS px, and resizing it doesn't change the page width (same as Website 8), so signed-in shots are desktop width only.
  - Nothing that writes was clicked there: no dial turn (a turn saves her position), no quiz, no cart.

---

## Task 0.1 — Dana's items: the code path and the proposed fix

### 1 · Home, signed in: "I'm chocolate and nutty and then I see the balance picture"

- **Confirmed on prod:** section 03 reads "You're a Chocolate & Nutty — shop your matches." next to `optimized/home/family-balanced-sweet.webp`.
- **Code:** `Home.tsx:333` `const balancedPhoto = familyPhoto('balanced_sweet')!;` is used unconditionally by the figure at `Home.tsx:384`.
- **Fix (D17):** use `familyPhoto(homepageState.archetype.id)` when `homepageState?.archetype` is set; keep `familyPhoto('balanced_sweet')` only for the invite branch (`showInvite` / `NEW_NO_QUIZ`). The fallback chain is unchanged (`homeAssets.family[slug]` → `archetypeAssets[slug].hero`).
- **Note:** the `'balanced_sweet'` literal and `SLUG_BY_CODE` (`Home.tsx:42–45`) are typed codes. That's pre-existing and harmless here; logged, not fixed.

### 2.1 · The dial is hard to turn, and the screen jumps

Reproduced on both counts. There are three separate causes.

**(a) The wheel moves under the pointer** (the "screen jumps"). `bloomField.css:28` sets `.bf-dial-left { align-self: center; }`. The wheel is vertically centred in a three-column grid row whose height is set by the coffee column, and that column changes height with every stop:
- notes, spec rows and price for a live coffee;
- one "arriving soon" line for a Coming soon slot.

Measured on the production catalogue, stepping each family's four stops:

| width | Floral | Fruity | Balanced | Chocolate & Nutty | Earthy |
|---|---|---|---|---|---|
| 1280 | 50 px | 84 px | 84 px | **84 px** | 0 |
| 390 (stacked) | 0 | 0 | 0 | 0 | 0 |

On desktop the wheel jumps up or down by up to 84 px while you turn it. The drag angle is measured from the wheel's live position, so the turn fights the jump. Dana's screen is desktop width. The page `scrollY` never changed in any probe, so it is the wheel moving, not the page.

**(b) A drag that passes half a turn flips to the other end.** `FlowerWheel.tsx:120–123` normalises the angle from the drag start into ±π:
- once the pointer passes the point opposite its start, `d` jumps from +π to −π;
- `t` then jumps from one end to the other.

Measured:
- a counter-clockwise half-circle visits stops 2 → 3 → 4 → **1**;
- a straight horizontal drag through the centre goes 2 → **4** in one move;
- a straight drag across the upper third turns the wheel the opposite way to the lower third.

Dragging the wheel like a slider, which is the natural move with a mouse, gives these jumps. That leaves the 1 px range line as the only control that behaves, which is Dana's "I need to click on the straight line".

**(c) Every pointer move re-renders the whole field.** `FlowerWheel` `onChange` → `DialFieldLayout.tsx:124` `onChange={setT}`. Each move re-renders:
- the coffee column;
- the comfort-zone aside, which fetches `/api/coffees/:id/compatibility` for each new stop mid-drag;
- the reveal panel, which is keyed by `ds.currentKey` (`DialFieldLayout.tsx:230`) and so remounts on every stop crossed.

The old dial paints imperatively and doesn't render React during a drag (Task 0.2).

**Fix (D19), proposed:**
- **B1, the drag model:**
  - accumulate the angle per move (each move's delta normalised to ±π, summed), so the wheel never flips;
  - clamp to the sweep;
  - `preventDefault()` on `pointerdown`;
  - drag anywhere on the wrap, centre included (already true; keep it).
- **B2, paint during the drag:** set the rotation and the live stop imperatively, as `BloomDial` does. React state changes only when the stop under the needle changes (the coffee name still follows live). The reveal panel and the compatibility fetch follow the settled stop (on commit), not every crossing.
- **B3, the layout:** `.bf-dial-left { align-self: start; }` (or a fixed minimum height on the coffee column), so the wheel never moves. Acceptance: 0 px drift on the production catalogue at 1280.
- **B4, a bigger slider target:** make the tick row draggable as `BloomDial`'s ruler is (26 px tall, pointer capture), with the `<input type=range>` kept for keys and screen readers.

Dial semantics (stops, default slot, saved position, events) are untouched.

### 2.2 · Tabs: YOUR for her family, TO EXPLORE for every other

- **Confirmed on prod:** "YOUR | Chocolate & Nutty", then "TO EXPLORE" on Floral, Fruity, Balanced and Earthy.
- **Code:** `BloomPage.tsx:212–214` `kickerFor` = `'Your'` / `'To explore'`, typed, rendered at `BloomPage.tsx:299`. The same rule, typed in capitals, is at `DialArchetypeSection.tsx:242–244`. It only applies on a non-folded, non-embedded dial, which no page renders since Website 5, so it's dead code.
- **Why it isn't data:** the tab order comes from `/api/coffees/archetype-order`, but with no adjacency on prod it is just "her family, then `sort_order`" (Task 0.3), and the words are typed.
- **Fix (D16):** see Task 0.3 for the source. The tab kicker becomes the relationship's `customer_label` from the API; guests see none. Delete both typed rules.

### 2.3 · Clicking a lineup square jumps up to the dial; "where is the full profile?"

- **Jump, reproduced:** `DialFieldLayout.tsx:268` `onSelect={() => { commit(tOf(i, stops)); scrollToField(); }}`, with `scrollToField` at `:102–103` (`scrollIntoView` smooth). Measured: 1280 from 1120 → 241, and 390 from 1441 → 206.
- **Fix (D18/D20):** `onSelect={() => commit(tOf(i, stops))}` only. The selected state is already drawn (`selected={i === liveIdx}` → `.sh-card.on`).
- **"Full profile ↗" is a real link and does not bubble:**
  - `ShopCoffeeCard.tsx:128` renders `<Link to=/flavor-intelligence?archetype=…&slot=…>`, and the `own()` check (`:53–54`) keeps the card's select from firing.
  - Clicking it navigates; verified on the production catalogue.
- **Why it looks like nowhere:** the site has no scroll-to-top on route change (no `ScrollRestoration` / `scrollTo(0,0)` anywhere in `app/`). The Flavor Intelligence page opens at the previous page's depth:
  - 1280: `scrollY` 416, the page title 194 px above the top;
  - 390: `scrollY` 993, the title 803 px above.

  It also opens in the old palette (Flavor Intelligence has 64 hex literals). See audit AU9 and AU10.
- **Fix:**
  - a route-change scroll reset in `App.tsx` (top on `PUSH`; keep the hash deep links `/shop#family` and the Bloom `?archetype=` landing working);
  - the Flavor Intelligence colour swap folded into OT-67 (Q5).

### 3 · Shop: the same relationship line on every family

- **Code:** `ShopAll.tsx:185` `{pad2(f.sortOrder)} — {mine ? 'Your family' : 'Family of taste'}`. Only her own family gets a word, and it's typed.
- **On prod:** "04 — YOUR FAMILY / Chocolate & Nutty", then "FAMILY OF TASTE" on the other four, in `sort_order` (no adjacency).
- **Fix (D16):** each section's kicker is the family's `customer_label` from the same payload as the Bloom tabs; guests keep the brand line "Family of taste". The section order follows the same relationship order.

---

## Task 0.2 — Wheel comparison

Where each dial renders today:
- `/bloom`: `FlowerWheel` (field layout).
- Quiz result, primary family (7B): `FlowerWheel`.
- Quiz returning-user screen, Worth exploring, `/profile`: `BloomDial`, folded or embedded. "Turn the wheel, or slide the bar" is the one Dana prefers; it's what she sees on `/find-my-flavor` signed in.

| | `BloomDial` (the reference) | `FlowerWheel` (`/bloom`, the quiz result) |
|---|---|---|
| Drag target | `.bd-dial-wrap`, the whole 400×400 box (canvas and linework `pointer-events: none`) | `.bf-wheel-wrap`: petals and the svg box; the centre works too (`elementFromPoint` = `svg`) |
| Listener wiring | native `addEventListener`, set up once per archetype | React props, re-created each render |
| `pointerdown` | `preventDefault()` + `setPointerCapture` | `setPointerCapture` only, no `preventDefault` |
| `touch-action` | `none` on the wrap **and** the ruler | `none` on the wrap; the range input is default |
| `user-select` | `none` on the whole instrument | `none` on the wrap only |
| Angle model | `startRot + (angle − startAngle)`° clamped to ±TRAVEL. No wrap fix, so a drag through the centre can jump too | `t0 − d/1.5π`, with `d` folded into ±π: **flips end to end** at half a turn (measured 2→3→4→1, and 2→4 straight through the centre) |
| During drag | imperative `paint()` on refs; no React render | `setT` per move → whole field re-renders, reveal panel remounts per stop, compatibility fetch per stop |
| Snap | on release only (`snap()`), 560 ms CSS transition back to the stop | on release (`commit`), then a rAF ease (`d × 0.18` per frame) |
| Animation loop | CSS transition, none while dragging (`bd-dragging`) | rAF loop, cancelled while dragging (`instant`) |
| Second control | the ruler: 26 px tall drag strip + needle, pointer capture, `touch-action: none` | native range: **1 px track**, 4×30 px thumb |
| Keys | ← → on the wrap and the ruler (the wrap is focusable) | ←→↑↓ Home End on the range only; the wheel isn't focusable |
| Layout | own fixed instrument box, never moves | `align-self: center` in a grid: **moves 50–84 px per stop** at desktop width (prod catalogue) |
| Touch (390) | works | works (a finger swipe moved 1 → 3) |

Every `scrollIntoView` and `focus()` on the Bloom page and in the field:

| Where | Trigger | Under D18 |
|---|---|---|
| `BloomPage.tsx:153` | deep link `?archetype=experimental` (load or URL change) | keep |
| `BloomPage.tsx:162` | deep link `?archetype=&slot=` (load or URL change) | keep |
| `BloomPage.tsx:168` `focus()` on the tab | ←/→ in the tab list (keyboard tab move) | keep (it focuses the tab bar the keyboard is in, not the field) |
| `BloomPage.tsx:205` | door click (off: `DOORS_ENABLED` false) | keep |
| `BloomPage.tsx:296` | **every** tab click, smooth to the field | only when the field is out of view |
| `DialFieldLayout.tsx:102–103, 268` | **lineup card click** | remove |
| `useAdjacentArchetype.ts:72` | Worth exploring chip (quiz, profile), not `/bloom` | unchanged |

Also from reading the code (not reproduced):
- Clicking the tab that is already selected sets `internalNav.current = true` (`BloomPage.tsx:166`) but doesn't change the URL. The deep-link effect never runs to clear the flag, so the next real deep link while on `/bloom` (a Liam action link) is ignored once. Fix: set the flag only when the value changes.
- `BloomPage.tsx:269` has a `#ffffff` literal (use the token).

---

## Task 0.3 — The relationship source (G2.4)

**`archetype_relationship`** (`CATALOG.md`, section "deprecated").
- **Columns:** `id` uuid PK, `from_archetype_id`, `to_archetype_id` (FK `coffee_archetype`), `dimension_id`, `direction` text, `strength_delta` numeric, `created_at`.
- **Writer:** none. **Readers:** none. 0 rows. The `schema.sql` comment says "do not add a new consumer of this table; use v_coffee_archetype_adjacency instead".
- **Not the home.** It models a per-dimension shift between two families (direction, strength), not a customer-facing vocabulary:
  - it has no label or code columns;
  - it isn't keyed to a customer;
  - reviving it would contradict its own deprecation.

  It stays dead; dropping it is its own brief.

**`v_coffee_archetype_adjacency`** (derived from `v_coffee_archetype` + `v_coffee_hop`). One row per family pair with active bridge hops: `hop_count`, the more/less split, `avg_confidence`.
- **On prod today it returns no pairs** (`GET /api/axis/adjacency` → `{"adjacency":{}}`). That matches the open item "no bridge hops/bands on prod" from coffee presentation brief 4.

**`catalogReads.getArchetypeOrder`** (`catalogReads.ts:175–195`):
- the customer's family first;
- then families with an edge, by `hop_count` desc, `avg_confidence` desc, `sort_order`;
- then the rest by `sort_order`.

With no edges the live order is just own + `sort_order`, e.g. `chocolate_nutty` → `[chocolate_nutty, floral, fruity, balanced_sweet, earthy]`.

**Two more relationship rules already exist in the code, both typed:**
- `coffee-info/useCompatibility.tsx:42–51` `getCompatibility()` gives `wheelhouse` / `exploring` / `stretch` per family, from the same (empty) adjacency map, read a second time through `archetypeAdjacency.ts` → `GET /api/axis/adjacency` (SQL in the route, `routes/axis.ts:19–31`). Its words are typed in `BADGE_CONFIG` (`:35–39`: "In your wheelhouse" / "Worth exploring" / "Outside your comfort zone").
- `compatibilityReads.compareCoffee` (`:133–136`) gives a per-coffee `in` / `edge` / `outside`, from the cupping-profile distance between the coffee and the customer's family. Thresholds are in `evidence_parameter` (`comfort_zone_edge_delta`, `dimension_delta_significant`). Its words are typed in `COMFORT_ZONE_LABEL` (`useCompatibility.tsx:14–18`). This one works on prod today: it's the Bloom aside's pill.

**Proposal:**
- **Lookup (G2.7, G2.3 prefix `coffee_`):** `coffee_archetype_relationship_kind` (`id` SERIAL PK, `code` UNIQUE, `label`, `customer_label`, `sort_order`). Seeded with:
  - `own` "Your family";
  - `adjacent` "Worth exploring";
  - `distant` "Outside your comfort zone".

  Codes say what the relation is and labels say what the customer reads.
  - **G2.4:** `archetype_relationship` doesn't fit (above).
  - **G2.4:** `lookup_value` is the generic key/value lookup, but it has no `customer_label` / `sort_order` pair per code as G2.7 asks for a customer-facing vocabulary.
  - **G2.4:** no `coffee_*` lookup holds family-to-family relations.
- **One service function:** `catalogReads.getArchetypeRelationships(customerArchetype)` returns, per real family, `{ archetype, code, customerLabel, rank }`. `getArchetypeOrder` becomes a projection of it, so the order and the labels can never disagree.
- **One reader path:** no second endpoint. `GET /api/coffees/archetype-order` adds a `relationships` field next to `order`. The Bloom page already calls it, and the Shop calls it through `getArchetypeOrder()` in `lib/api`. Guests (no `?archetype=`) get the order and no `relationships`.
- **How a family is classed: Q1 decides.** Adjacency alone puts all four of Dana's other families in `distant` today.
- **Later, same lookup (Q2):** `getCompatibility()`'s family level reads these relationships instead of its own adjacency fetch (removing the second reader). `COMFORT_ZONE_LABEL` / `BADGE_CONFIG` move to labels in this table or a sibling, so no relationship word stays typed.
- **Docs:** `comments.sql` for the table (`Writer: seed`, `Readers: catalogReads.getArchetypeRelationships`), then `catalog:md`.

---

## Task 0.4 — Site audit

Signed out, local, 1280 and 390, every page: no page errors, **no horizontal scroll**, no roaster name on any page (scanned against every roaster name in the test DB), and none of the handoff's typed counts or D14 roasting/shipping-time lines, except where listed below.

The local-only noise was ignored:
- the App Check debug-token 403;
- a 500 on `/api/users/profile` for the anonymous guest (the local Firestore write guard);
- 404 dial positions for a guest.

Screenshots (not committed) are in `C:\Users\DanaB\AppData\Local\Temp\claude\20c403dcb07ce225\18171931-091c-4fbf-b830-e6e8a7e8601e\scratchpad\a9\` (`<page>-1280.png`, `<page>-390.png`, `prod-cn-stop1..4-1280.png`, `prod-fullprofile-landing-*.png`). The signed-in prod shots are in `C:\Users\DanaB\AppData\Local\Temp\claude-chrome-screenshots-MB1os0\` (2–11).

| Page | Signed out (1280 / 390) | Signed in (prod, Dana) | Findings |
|---|---|---|---|
| `/` | ok; Balanced figure (correct for a guest) | "You're a Chocolate & Nutty", **Balanced figure** | item 1; AU1; AU3 |
| `/` without `?preview` | — | the pre-launch curtain | AU5 |
| `/shop` | ok | "04 — Your family", the rest "Family of taste", `sort_order` | item 3; AU1 |
| `/bloom` | ok; lineup card jumps; wheel flip | YOUR / TO EXPLORE; opens on her saved stop 4 (a Coming soon slot) | items 2.1–2.3; AU11; AU13; AU14 |
| `/flavor-intelligence` (Full profile) | lands 416 / 993 px down; old palette | — | AU9; AU10 |
| `/the-axis` | ok | ok | AU4 |
| `/find-my-flavor` entry, question, branch, result | ok at both widths; guest gate shown | returning screen (`BloomDial`): "Award-winning, per the roaster", "shipping included" | AU6; AU7 |
| `/sign-in` | ok | signed in, it still shows the Create profile form | AU12 |
| `/cart` | ok (empty) | ok (empty) | AU1 |
| `/checkout` | → `/sign-in?redirect=/checkout` | empty cart → `/bloom` (as before) | OT-93 (drawer); `/checkout/return` not walked (needs an order): OT-94 |
| `/profile` | → sign-in | old palette, typed archetype features, award tag, "shipping included" | AU7; AU8; OT-67 |
| `/sommelier` | → sign-in | ok; no "explore"/"confidence" in the chrome | OT-67 (18 literals) |

**Audit findings**
- **AU1 Old colours on every page.** The floating cart button, its drawer and the 💬 Talk to Liam button use `#9a2918` / `#f2f1ea` (`bloom/FloatingCart.tsx:37, 46, 58, 81, 101`). This was F3 in 7A. Swap to the tokens.
- **AU3 Home.** The company-gift redemption under section 03 uses `#a33726` / `#ee5974` (`CompanyGiftRedemption.tsx:75, 83, 90`). Swap to the tokens.
- **AU4 The Axis, G4.4 (positive register, "not X, but Y").**
  - `TheAxis.tsx:186` "A position is not a poetic note."
  - `:204` "They're not a separate world."
  - `:243` "…how you experience flavor — not what you know about coffee." plus "Three minutes."

  Website 6 copy. Proposed rewrites are for Dana to approve.
- **AU5 Pre-launch curtain** (what every visitor sees at `/` today):
  - `PreLaunch.tsx:178` "Six flavor worlds. One is yours." (a typed count, D15 spirit);
  - `:187` "Free · three minutes · no account needed";
  - "The doors open this fall."

  Dana's call (Q4).
- **AU6 Quiz gate:** `PostQuizEmailGate.tsx:79` "First access when doors open this fall." (and `CrawlLanding.tsx:57`). It's a launch-timing line, not roasting or delivery (D14), so it's Dana's call (Q4).
- **AU7 The old `BloomDial` card** (quiz returning screen, `/profile`, Worth exploring):
  - The award tag reads "Award-winning, per the roaster" (a card-tag label from `roasterVoiceReads.ts:85`), where the handoff surfaces show "Premium ★" (D12).
  - "shipping included" is typed at `DialArchetypeSection.tsx:312` (D13: the shipping line comes from `getCheckoutRules()`). It's also not true for one bag ("Free shipping with 2 bags").
- **AU8 `/profile`:**
  - the archetype "features" ("You prefer a bold and comforting cup", …) are typed in `routes/users.ts:51–58` (G2.1, pre-existing; the comment there says they have no catalog source);
  - "You haven't tried your match yet — it's below." (`Profile.tsx:399`);
  - 111 hex literals (OT-67).
- **AU9 No scroll reset on navigation** anywhere in the app. Every `Link` opens the next page at the old depth. This is the "where is the full profile?" (item 2.3).
- **AU10 Flavor Intelligence** (the Full profile target) is in the old palette, with 64 hex literals. It isn't on OT-67's list (Q5).
- **AU11 `/bloom` signed in** opens on Dana's saved stop 4, "Working Late Hours", a Coming soon slot. That's the saved-position rule working as built (the brief forbids changing dial semantics). The field still offers "Save to flavor memory" on that Coming soon stop (`DialFieldLayout.tsx:207`, `!ds.isPlaceholder`). Small; listed, no fix proposed unless Dana wants one.
- **AU12 `/sign-in` while signed in** shows the Create profile form. Proposed: send a signed-in visitor to `redirect` or `/profile`.
- **AU13** `BloomPage.tsx:269` `background: '#ffffff'` → the page token.
- **AU14** The stale `internalNav` flag (Task 0.2).
- **Not a finding:** the Home Liam example box (section 08) is a dark box showing only "YOU" in the full-page capture. The thread plays on scroll-into-view, which a full-page capture doesn't trigger. Worth one look in Dana's browser.

---

## Task 0.5 — The proposed fix list

**Part A, schema/API (about ½ day)**
1. `coffee_archetype_relationship_kind` lookup, seeded `own` / `adjacent` / `distant`, with `comments.sql`, then `catalog:md`.
2. `catalogReads.getArchetypeRelationships()`, classed as Q1 decides; `getArchetypeOrder` derived from it.
3. `relationships` added to `GET /api/coffees/archetype-order` (one reader; guests get none).
4. Tests on the test DB: one row per real family, own first, the classing with and without hops, guests unlabelled, the seed is idempotent.

**Part B, the wheel and The Bloom (about 1 day)**
1. `FlowerWheel` drag: per-move angle accumulation (no flip at half a turn), `preventDefault` on down, drag anywhere, imperative rotation during the drag, React state only on a stop change; snap on release as today.
2. `.bf-dial-left` stops centring (drift 0 px at 1280 on the production catalogue).
3. The reveal panel and the compatibility fetch follow the settled stop, not every crossing.
4. The tick row becomes a 26 px drag strip, as on `BloomDial`; the range input stays for keys and screen readers.
5. D18:
   - a lineup card click turns the dial in place (remove `scrollToField`);
   - a tab click scrolls only when the field is out of view;
   - the `internalNav` fix.
6. D20: the card's Full profile link already works; add the route-change scroll reset (`App.tsx`, keeping hash and `?archetype=` landings).
7. D16 tabs: the kicker from `relationships`; delete `kickerFor` and the dead typed rule in `DialArchetypeSection.tsx:242–244`.
8. Tests: no scroll on a wheel, slider, key or card turn; a turn past half a circle stays on the near end; the card link navigates and doesn't turn the dial; tabs labelled from a mocked payload; the wheel doesn't move between stops (layout assertion).

**Part C, Home and Shop (about ½ day)**
1. D17: Home's section 03 figure follows `homepageState.archetype`; Balanced only for the invite branch. Test per stage.
2. D16 Shop: section kicker and order from `relationships`; "Family of taste" for guests. Test from a mocked payload.
3. (Q2) `useCompatibility`'s family level reads `relationships`; the pill words leave the code.

**Part D, other pages (about 1–1½ days)**
1. OT-93: the drawer's sign-in link becomes `/sign-in?mode=signin&redirect=/checkout`. Test.
2. OT-94: the `/checkout/return` line to order facts only (D14). Copy for Dana.
3. OT-67, colour and type only, no layout change:
   - the ten listed pages: Profile 111 literals, Liam (Sommelier) 18, About 44, How it works 20, Privacy 2, Terms 3, Crawl 37, QR door 3, Join household 27, pre-launch pages 22 (≈ 290 literals);
   - plus `FloatingCart` (AU1) and `CompanyGiftRedemption` (AU3);
   - plus Flavor Intelligence (64, AU10) if Q5 says yes.
4. AU7: "shipping included" → the `getCheckoutRules()` line; the award tag per Q4.
5. AU4, AU5, AU6 copy, once Dana has picked the wording (Q4).
6. AU12: sign-in redirects a signed-in visitor. AU13.

Total about 3–3½ days, one run, one report. Acceptance as the brief says: Dana's five items re-checked live in her browser, signed in.

## Decided 2026-11-06 (Dana)

- **Q1: C.** A family pair with bridge hops is `adjacent`. Otherwise the family is classed by cupping-profile distance, on the per-coffee pill's `evidence_parameter` thresholds. **Family reference profiles are pooled from cupped coffees only, never from `archetype_vector` or `v_archetype_vectors`.**
- **Q2:** codes `own` / `adjacent` / `distant`; labels "Your family" / "Worth exploring" / "Outside your comfort zone". The per-coffee pill words and the old badge words move into the same lookup now.
- **Q3:** fix the flower wheel.
- **Q4:**
  - rewrite the three Axis lines;
  - remove "this fall" from the curtain and the gate (no date, no count typed);
  - the old card shows Premium ★ and reads shipping from the rules.
- **Q5:** yes. Flavor Intelligence joins the OT-67 swap.
- **Also in scope:** AU8 (Profile features = the family's `customer_words` from the API), AU9, AU11, AU12.

The run continues through Parts A–D to push, deploy, `catalog:md`, startup log, production smoke and this report.

## Questions for Dana (each one changes the fix) — answered above

- **Q1, what makes a family "Worth exploring"?** Production has no bridge hops, so adjacency classes every other family as "Outside your comfort zone".
  - **A.** Adjacency only, as D16 says. Honest, but every non-own family reads "Outside your comfort zone" until hops are authored.
  - **B.** Cupping-profile distance between the families: each family's pooled profile against hers, on the same `evidence_parameter` thresholds the per-coffee pill already uses (the "edge" threshold → Worth exploring, the "significant" threshold → Outside). Works on today's data; Part A first checks that every family has a reference profile.
  - **C (recommended).** Adjacency when a family pair has hops, B otherwise. The curated graph wins wherever it exists, and the labels are data from day one.
- **Q2, the codes and words.** Are `own` / `adjacent` / `distant` → "Your family" / "Worth exploring" / "Outside your comfort zone" right? Should the per-coffee pill words and the old badge words move into the lookup in this brief (Part C3), or in a later one?
- **Q3, the wheel.** Keep the flower wheel and fix it (B1–B4, recommended; D19), or put the old `BloomDial` back on `/bloom`?
- **Q4, copy.**
  - The Axis lines (AU4): rewrite now?
  - The pre-launch curtain and the gate's "this fall" (AU5, AU6): keep or change?
  - The old card's award tag (AU7): "Premium ★" as on the handoff pages, or keep "Award-winning, per the roaster"?
- **Q5.** Add Flavor Intelligence (the Full profile page) to OT-67's colour swap?

---

## What was built (Parts A–D)

**Part A, schema and API**
- **`coffee_archetype_relationship_kind`** (G2.7, prefix `coffee_`):
  - `id` SERIAL, `code` UNIQUE (`own` / `adjacent` / `distant`), `zone_code` UNIQUE (`in` / `edge` / `outside`), `badge_code` UNIQUE (`wheelhouse` / `exploring` / `stretch`), `label`, `customer_label`, `zone_label`, `badge_label`, `sort_order`, `created_at`.
  - Seeded with Dana's words (Q2) and the old pill and badge words.
  - `comments.sql`: `Writer: seed`, `Readers: archetypeRelationshipReads`. Reader lines were also updated on `v_coffee_archetype_adjacency` and `v_archetype_dimension_profile`.
  - **G2.4:** `archetype_relationship` doesn't fit (deprecated, per-dimension, no words). `lookup_value` has no `customer_label` per code. No `coffee_*` lookup holds family relations.
- **`services/archetypeRelationshipReads.ts`:**
  - `getArchetypeRelationships(match)` follows Q1 = C:
    - hops → `adjacent`;
    - else the largest midpoint difference over shared dimensions of the two families' cupped profiles (`v_archetype_dimension_profile` over `v_coffee_dimension_range`): `> param('dimension_delta_significant')` → `distant`, else `adjacent`;
    - a family with fewer than `param('archetype_profile_min_coffees')` cupped coffees (or no shared dimension) and no hops → no label.
  - Order: own; hop-adjacent (hops, confidence); profile-adjacent (distance); distant (distance); unlabelled; ties by `sort_order`. `getArchetypeOrder` is its projection.
  - `getArchetypeOrderPayload` → `GET /api/coffees/archetype-order` returns `{ order, relationships? (matched), kinds }`.
  - A test pins that no `archetype_vector` / `v_archetype_vectors` appears in the service.
- **`catalogReads.archetypeCustomerWords(code)`:** Profile and Home "features" (AU8). `routes/users.ts` keeps only the colour map.
- **Deviation:** coffee presentation brief 3 decision 1 said the order is "adjacency, not distance". Dana's Q1 = C (today) extends it with the cupped-profile distance where there are no hops. Noted here as that decision's update, not a silent change.

**Part B, the wheel and The Bloom**
- **`FlowerWheel`:**
  - each pointer move's angle step is folded into (−π, π] and summed (`angleStep`), so a turn never flips at half a circle;
  - a pointer within 12 % of the wheel's size from the centre turns nothing;
  - `preventDefault()` on pointerdown (no selection, no focus jump);
  - the wheel repaints from local state while dragging, and the parent hears `onChange` only when the stop changes;
  - the tick row and line are one drag strip (`.bf-bar`, 47 px tall, `touch-action: none`), while the range input stays for keys and screen readers (`pointer-events: none` on it);
  - snap on release; `onDragChange` tells the layout a turn is in progress.
- **`DialFieldLayout`:**
  - the comfort-zone line keeps its coffee while dragging;
  - a lineup card commits only, and the lineup is held at its screen position across the change (measured before, corrected in a layout effect before paint);
  - "Save to flavor memory" only on a stop with a coffee (AU11).
  - `bloomField.css`: `.bf-dial-left { align-self: start }`, and the petal fill is on `--ab-paper`.
- **`BloomPage`:**
  - tab kickers from `useArchetypeRelationships`;
  - a tab click scrolls only when the field is out of view (its end under the header, or its top below 75 % of the viewport);
  - `internalNav` is set only on a real URL change;
  - the page background is `var(--ab-page)`.
  - The dead typed YOUR / TO EXPLORE rule in `DialArchetypeSection` is removed.

**Part C, Home and Shop**
- **`Home.tsx`:** section 03's figure is `familyPhoto(homepageState.archetype.id)` when signed in with a family past `NEW_NO_QUIZ`, else the Balanced photo (D17).
- **`ShopAll.tsx`:** each section's kicker is `{nn} — {relationship label}` whenever her family is known (with the toggle on or off), "Family of taste" otherwise; the order follows the payload with "Your family first".
- **`lib/useArchetypeRelationships.ts`:** the one client of the payload, cached per family. `useCompatibility`'s family level, `CompatibilityBadge` and `ComfortZoneAside` read their level and words from it. `COMFORT_ZONE_LABEL`, the `BADGE_CONFIG` words and the stretch apology line ("…but that's not a bad thing", G4.4) are gone. The badge colours are on the tokens.

**Part D, other pages**
- **OT-93:** `CHECKOUT_SIGN_IN_HREF` (in `CartLines.tsx`) is used by the drawer and `/cart`.
- **OT-94:** `/checkout/return`: "Your order is placed." and "Your subscription has started with this order." The generated order-placed beat still leads when it exists (OT-96).
- **OT-67 (+AU1, AU3, AU10):** 261 literals → tokens (`#9a2918`/`#a33726` → `--ab-ink`, `#f2f1ea` → `--ab-paper`, `#ee5974` → `--ab-mark-b`, `#deded1` → `--ab-ink-hairline`; `rgba(...)` forms and QrDoor's `${RUST}99` → `color-mix` of the token):

  | File | Literals |
  |---|---|
  | Profile | 111 |
  | Flavor Intelligence | 37 |
  | About | 29 |
  | Join household | 26 |
  | Crawl | 14 |
  | `CompanyGiftRedemption` | 12 |
  | `FloatingCart` | 10 |
  | How it works | 8 |
  | Pre-launch curtain | 6 |
  | Terms | 3 |
  | Privacy | 2 |
  | Liam | 1 constant |
  | QR door | 1 constant |
  | Post-quiz gate | 1 constant |

  Neutral greys and family colours stay (OT-98). Lato stays (D1).
- **AU9:** `ScrollToTopOnNavigate` in `App.tsx`: a PUSH or REPLACE to a new path scrolls to the top. POP, a hash and a query-only change don't.
- **AU12:** `/sign-in` sends a visitor who arrived signed in (not anonymous) to `redirect` (default `/profile`).
- **AU7:** `CardTags` shows "Premium ★" for an award tag. The old dial card's shipping line comes from `getCheckoutRules()` ("Free shipping" / "Free shipping with N bags").
- **Copy (Q4):**

  | Where | Was | Now |
  |---|---|---|
  | The Axis | "A position is not a poetic note. It's a claim we can check — and we do. … We'd rather tell you a coordinate is young than pretend it was born perfect." | "A position is a claim we can check, and we do. … As cuppings and drinker feedback accumulate, the position hardens, and we tell you how young each coordinate is." |
  | The Axis | "…hard to place. They're not a separate world. Each one lives near its kin…" | "…hard to place. Each one lives near its kin…" |
  | The Axis | "Three minutes. A few questions about how you experience flavor — not what you know about coffee. …" | "A few questions about how you experience flavor: moments, reactions, familiar foods. …" |
  | Curtain | "The doors open this fall." | "Find your flavor before the doors open." |
  | Curtain | "Six flavor worlds. One is yours." | "One flavor world is yours." |
  | Post-quiz gate | "…plus first access this fall." / "First access when doors open this fall." | "…plus first access when the doors open." / "First access when the doors open." |
  | Quiz sealed line | "You're on the first-access list for this fall." | "…for when the doors open." |
  | Crawl perk | "…drawn when the doors open this fall." | "…drawn when the doors open." |

  The curtain's "Free · three minutes · no account needed" is unchanged (no date, no count).

## Evidence

**Backend:**
- `db/archetypeRelationships.test.ts` **10/10**:
  - `profileDistance`;
  - hops → adjacent, profile within the significant threshold → adjacent, further → distant, too few cupped coffees → unlabelled, with the order;
  - profile-adjacent ordering by distance;
  - guests and unknown codes get no codes;
  - `getArchetypeOrder` is the projection;
  - no `archetype_vector` in the service;
  - the lookup seed run twice gives the three rows with every word;
  - the route payload, matched and guest;
  - AU8 `archetypeCustomerWords`.
- `coffeePresentation3.test.ts` (the hop-order tests, now with no profiles in their fixture) passes. `comments.format` passes.
- **Full suite:** 1146 / 1161. 7 are the known baseline (6 `quizScoring`, OT-73 `catalog_blueprint`). The other 8 were timeouts on a slow test database (30–120 s: `catalogSizes` ×3, `roasteryPortalPart3` ×2, `coffeePresentation2` ×3; no session was blocked, only slow view queries). Rerun alone, those three files pass, **44/44**.
- **CI lints, all exit 0:** `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage`. Backend `tsc --noEmit` clean.

**Frontend:**
- vitest **140/140** (11 files). New: `website9.test.tsx` (9):
  - `angleStep` sums a 300° sweep without a flip;
  - a counter-clockwise drag past half a circle reports stops 1, 2, 3 once each and commits stop 4, with `preventDefault`;
  - clockwise from the start stays at 0;
  - the bar drags to the last stop;
  - slider keys step;
  - the scroll reset (new path yes; query or hash no);
  - the drawer link equals `/cart`'s;
  - the badge words from the payload, with no apology line;
  - `CardTags` "Premium ★".

  Additions:
  - `bloom.test.tsx`: no scroll on a card click, the card selected; no save on a Coming soon stop; slider keys and an in-view tab click don't scroll, an out-of-view tab does; the tab kicker is "Your family" from the payload;
  - `shop.test.tsx`: every section's word from the payload, with the toggle on and off, and "Family of taste" with no evidence;
  - `home.test.tsx`: the figure per stage;
  - `signin.test.tsx`: a signed-in arrival redirects, an anonymous guest stays.
- `tsc --noEmit`: the known 7 errors only (`ArchetypeSection` hops, `useAdjacentArchetype`, `Profile` `address_type`). `vite build` clean.

**Local acceptance (G5.2), 1280 and 390:** the new build against the **production catalogue**, read-only (Vite proxied to the prod API, every non-GET request aborted in the browser; `scratchpad/accept9.mjs`).

| Probe | Task 0 (before) | Now, 1280 | Now, 390 |
|---|---|---|---|
| Wheel movement stepping each family's 4 stops | 50 / 84 / 84 / 84 / 0 px | 0 px every family | 0 px every family |
| Counter-clockwise drag over 315° from stop 1 | 2 → 3 → 4 → **1** | 1 → 2 → 3 → 4, settles 4 | same |
| Straight drag through the centre | 2 → **4** in one move | no turn (dead zone) | same |
| Bar drag, left to right | (1 px line only) | 1 → 2 → 3 → 4, strip 47 px, no text selected | same |
| Lineup card click | page scrolled 1120 → 241 | card stays at 320 px on screen, selected, dial on its stop | card at 297 → 296 px (the browser's scroll anchoring) |
| Tab click, field in view | (always scrolled) | no scroll (273 → 273) | no scroll (615 → 615) |
| Full profile ↗ | opened 416 / 993 px down | opens at 0 | opens at 0 |
| Page errors | — | none | none |

Screenshots: `scratchpad/a9b/after-field-*.png`, `after-lineup-*.png`, `after-fullprofile-*.png`.

**Production:**
- **Commit and deploy:** `1870047`, run 42315736776 green (backend and frontend), revision **`axis-bloom-backend-00836-gvr`**.
- **Startup log:** no ERROR. `DB schema verified`, `[db-comments] applied 1659 statements`, `[db-roles] schema applied as axisbloom; request pool is ab_app`. The known findings only: `[sommelier-integrity]` #3, `[evidence-integrity]` #2 and #6, `[quiz-integrity]` #10, and `[data-catalog]` 156 tables / 78 views / 1425 columns with #6 (dead tables) and #4 "CATALOG.md stale".
- **`catalog:md`:** `npm run catalog:md -- --expect-db axisandbloom` wrote `CATALOG.md` (catalog-hash `453228a9…`, the live hash in the boot log, so #4 clears on the next boot), committed with this report.
- **`GET /api/coffees/archetype-order` on production:**

  | Customer family | Your family | Worth exploring | Outside your comfort zone | No label (OT-95) |
  |---|---|---|---|---|
  | Chocolate & Nutty | Chocolate & Nutty | Fruity | Balanced | Floral, Earthy |
  | Fruity | Fruity | Chocolate & Nutty, Balanced | — | Floral, Earthy |
  | Balanced | Balanced | Fruity | Chocolate & Nutty | Floral, Earthy |
  | Floral | Floral | — | — | all four |
  | Earthy | Earthy | — | — | all four |

  - Every non-own class is profile-based: production has no bridge hops.
  - Floral and Earthy have too few cupped coffees for a profile (`archetype_profile_min_coffees`).
  - A guest gets the order, the three words and no `relationships`.
- **Dana's Chrome, signed in as admin, desktop width 2195 px.** Resizing doesn't change the page width; the 390 and 1280 evidence is the acceptance table above, same build. Nothing that writes was clicked: no dial turn, no card click, no quiz.
  - **`/bloom`:**
    - tabs "YOUR FAMILY · Chocolate & Nutty", "WORTH EXPLORING · Fruity", "OUTSIDE YOUR COMFORT ZONE · Balanced", then "Floral", "Earthy" (no kicker);
    - the wheel column `align-self: start`;
    - the drag strip is 47 px;
    - the aside reads "In your comfort zone" from the lookup;
    - Full profile ↗ → `/flavor-intelligence?archetype=chocolate_nutty&slot=1` at `scrollY` 0, title on screen.
  - **`/shop`:** "04 — YOUR FAMILY", "02 — WORTH EXPLORING", "03 — OUTSIDE YOUR COMFORT ZONE", "01 — FAMILY OF TASTE", "05 — FAMILY OF TASTE".
  - **`/`:** section 03 "You're a Chocolate & Nutty — shop your matches." beside `optimized/home/family-chocolate-nutty.webp` (`data-family=chocolate_nutty`).
  - **`/sign-in`:** while signed in it lands on `/profile`.
  - **`/profile`:**
    - "Your archetype" reads Full / Grounded / Comforting (the family's words);
    - the card tag reads PREMIUM ★ (no award wording);
    - the card's shipping line reads "Free shipping with 2 bags";
    - the page is on the tokens.
  - **`/the-axis`:** the rewritten lines are live and none of the three "not" lines remain.
  - **The floating buttons:** `rgb(186, 76, 56)` (`--ab-ink`).
  - **Extension limits:** it again failed once with "Cannot access a chrome-extension:// URL of different extension" and once timed out on a screenshot; the checks above are from the retries.
- **Not checked on production:**
  - a real wheel drag and a lineup click signed in, because both save Dana's dial position. They are covered by the acceptance table on the production catalogue.
  - `/checkout/return`, which needs an order.
  - **For Dana:** turn the dial on `/bloom` and click a lineup square in your own browser (item 2.1 and 2.3).

## Deviations and notes

- **The order rule:** coffee presentation brief 3 decision 1 ("adjacency, not distance") is extended by Q1 = C, as decided today.
- **Experimental and category coffees no longer get a compatibility badge.** They have no family relationship; before, they always read "Outside your comfort zone". Logged as OT-97 for Dana.
- **OT-67 covered the five old palette literals.** The neutral greys and the typed family colours in `routes/users.ts` stay (OT-98).
- **The order-placed beat (generated text) and `order_fulfillment_status` "Paid · being roasted"** are data and prompt changes outside this brief (OT-96).
- **New open tasks:** OT-95 (unlabelled families until there are more cuppings or hops), OT-96, OT-97, OT-98. **Closed:** OT-67, OT-93, OT-94.
