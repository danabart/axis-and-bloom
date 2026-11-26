# Closing report 13: `/map` on a laptop, and "More about this coffee" in the roaster's terms

Brief: `CLAUDE_CODE_PROMPT_ELLA_MAP_13_LAPTOP_LAYOUT_AND_ROASTER_PROFILE.md`.

## Task 0 (2026-11-26, read only on the test DB and production)

**Sessions.** danab-0a, the only other session listed, confirmed it was idle. HEAD is 677357c (brief 12, deployed).

**Data.** Every query below ran on both databases and gave the same answer for the 18 map coffees. The numbers are production's. Files:
- `backend/tmp/em13_q1_prod.md` and `em13_q1_test.md`: the 18 coffees.
- `em13_q2_prod.md`: the two dimension sets, the brew labels and the calibration view.
- `em13_q3_prod.md`: the scale check.

### Where the code disagrees with the brief (read these first)

1. **There is no 1-to-5 → bar conversion to reuse.**
   - The portal comparison (`v_evidence_roastery_calibration`, `v_evidence_dimension`) compares ranks within the roaster's lineup and never converts a value.
   - `roastery_portal_response_dimension` says the 1 to 5 is "relative to the roaster's own lineup, not an absolute cupping score". Putting it on the 0 to 15 cupping track would claim more than the roaster said.
   - **Proposal:** draw it on its own 1 to 5 track. The shared `DimensionBars` gets a scale prop that defaults to 15, so every other use is unchanged. The bar is one step wide, ending at the value. No number is stored or converted.
2. **"Accepted" vs "submitted".**
   - The existing view for the roaster's ratings (`v_roastery_portal_coffee_hint`) takes the **latest submitted** response. It doesn't check that we accepted it.
   - Three map coffees were submitted but never accepted: **Big City, Nightcap Decaf, The Daily**. With the brief's "accepted only", these three get no bars.
   - **Proposal:** submitted, as every other customer read of the roaster's answers does (`v_coffee_card`, the dot size on the map). Accepted-only would need a new filter or view.
3. **The brew answer is stored as one best plus an unordered set.** `roastery_portal_response_brew` has `role` = best or also_good, with no order among the also-good ones. "Their first choice first" can only mean the best one first. **Proposal:** the also-good ones follow in the lookup's own `sort_order`: Pour-over, Batch brew / drip, Espresso, French press, AeroPress, Moka pot, Cold brew.
4. **The brew answer and the ratings come from different versions, in theory.**
   - Today's brew tag reads the **current** response (`v_roastery_portal_current_response`: an open draft if there is one).
   - The ratings read the latest **submitted** one.
   - Every one of the 18 is "submitted, no draft", so both are the same version today. I'd keep both reads as they are and not change the Bloom page's read.
5. **An open panel "spans the full width under its row".** Each card holds its own panel (brief 12), so in a two-column row the panel would sit inside one column.
   - **Proposal:** at `lg`, the card whose panel is open spans both columns, with the panel inside it, so it stays under its own card.
   - The top card's panel spans the full width under the map-and-top-card row.
   - Moving the panel out of the card instead would mean a second render path for it.
6. **No map coffee lacks portal ratings.** All 18 have all 7. "A coffee with no portal ratings shows none" can only be shown with a test fixture (vitest), not on a real map coffee.

### Item 1: readers, writers and views (G3.9 amended)

| Need | Existing, reused | New |
|---|---|---|
| The roaster's ratings | `v_roastery_portal_coffee_hint.dimensions` (label, low_label, high_label, value; latest submitted response), read by `roasteryPortalReads.roasterFactsForCoffees(coffeeIds)` (Ella map 5, read only) | none |
| Where it shines | `roasterVoiceReads.getCardFacts(coffeeId)`: `bestBrew` and `alsoGoodBrews` as labels from `lookup_value` (`roastery_portal_brew_method`, "Other" left out), through `roasteryPortalReads.getCurrentResponseForCoffee` → `v_roastery_portal_current_response` | none |
| The two headings | `dial_customer_copy` (`v_dial_customer_copy`), writer `dialPlacementService.setCustomerCopy`; seed | two rows: `where_it_shines`, `roaster_rates` |
| The panel's reads | `useCoffeeDetail` (brief 12) calls `/api/coffees/:id/content`, `/flavor-wheel` and `/dimensions` | see below |

**Proposed for B (needs your yes):**
- **One public route,** `GET /api/coffees/:id/roaster-profile`, returning `{ whereItShines: string[], ratings: [{ label, lowLabel, highLabel, value }] }`. It calls only the two readers above, then drops held-back pairs. It is roaster-blind: no name, no respondent, no award.
- **`useCoffeeDetail` gains an option,** `withRoasterProfile`. Only `/map` sets it. The Bloom page never asks, so its reads and output stay as they are.
- **The alternative** is folding both into `/api/map/steps`. That would make the steps payload carry panel data for every card, before anyone opens a panel.

**The hold-back switch (item 3):**
- No existing table holds a per-roaster-and-dimension decision. Tables considered:
  - `roastery_portal_dimension` is per dimension only, and its `is_active` stops the portal asking.
  - `cupping_score_dispute` is about our cuppers' scores.
  - `evidence_parameter` holds numbers, not pairs.
  - `dial_*` tables are map content.
- It is only needed if you hold something back (item 3). If so, I propose `roastery_portal_dimension_hold`:
  - Columns: `id` SERIAL, `roaster_id`, `dimension_id`, `reason`, `raised_by_uid`, `created_at`, `withdrawn_at`, `withdrawn_by_uid`.
  - Insert-only, with one withdraw, the `cupping_score_dispute` pattern. It sits beside the roaster's answers and never changes them (G2.20).
  - View: `v_roastery_portal_dimension_hold`.
  - Writer: `roasteryPortalService.setDimensionHold`, one function for hold and withdraw.
  - Read by the new route.
  - Home: the admin Roastery Feedback **Calibration** table, which already lists every roaster × dimension with its rank correlation and "inverted". A Hide on `/map` switch goes on each row.
- If you hold nothing back now, I'd add nothing and leave the switch for when a pair needs it.

### Item 2: the roaster's ratings for the 18 map coffees

- **Scale:** 1 to 5, relative to the roaster's own lineup. Anchors: Acidity Soft–Bright, Sweetness Low–High, Bitterness Low–High, Body Light–Full, Clarity Clean–Layered, Mouthfeel Silky–Grippy, Finish Short–Lingering.
- **Coverage:** every one of the 18 has all 7, and **none has no ratings**.
- **No conversion** (see the first finding). The value is drawn on a 1 to 5 track.

| Coffee | Acidity | Sweetness | Bitterness | Body | Clarity | Mouthfeel | Finish | Response | Accepted |
|---|---|---|---|---|---|---|---|---|---|
| Blossom | 3 | 3 | 3 | 5 | 4 | 5 | 5 | v1 | yes |
| Brazil | 3 | 5 | 3 | 4 | 3 | 4 | 4 | v1 | yes |
| D.R. Congo | 4 | 5 | 3 | 4 | 2 | 4 | 3 | v1 | yes |
| Fabricator | 3 | 5 | 3 | 4 | 4 | 4 | 4 | v1 | yes |
| Geometric | 4 | 4 | 3 | 4 | 4 | 4 | 4 | v1 | yes |
| Indonesia | 2 | 2 | 3 | 4 | 3 | 5 | 3 | v1 | yes |
| Tiger Stripe | 4 | 4 | 3 | 5 | 4 | 5 | 4 | v1 | yes |
| Amsterdam | 1 | 3 | 4 | 4 | 2 | 3 | 4 | v1 | yes |
| Benchmark | 2 | 4 | 3 | 3 | 1 | 3 | 4 | v2 | yes |
| Big City | 1 | 2 | 5 | 5 | 3 | 5 | 5 | v1 | **no** |
| Cafè Feminista | 4 | 4 | 2 | 2 | 2 | 2 | 3 | v1 | yes |
| Great Heights | 1 | 3 | 4 | 5 | 3 | 4 | 4 | v2 | yes |
| Half Moon | 3 | 4 | 4 | 4 | 2 | 3 | 3 | v2 | yes |
| La Familia | 4 | 5 | 2 | 3 | 3 | 3 | 2 | v1 | yes |
| Nightcap Decaf | 2 | 4 | 4 | 3 | 3 | 3 | 4 | v1 | **no** |
| The Daily | 2 | 3 | 4 | 3 | 3 | 4 | 4 | v1 | **no** |
| The Village | 5 | 4 | 2 | 2 | 4 | 2 | 3 | v1 | yes |
| The Waverly | 3 | 4 | 4 | 3 | 2 | 4 | 3 | v2 | yes |

Blossom through Tiger Stripe are one roaster's seven coffees; the eleven from Amsterdam down are the other roaster's.

### Item 3: scale check (roaster vs A&B's pooled range, per roaster and dimension)

- **Method:** each roaster's coffees on the map, plus their other active coffees, ranked by the roaster's value and by A&B's pooled midpoint (`v_coffee_dimension_range`, 0 to 15). I took the rank correlation, the same measure as `v_evidence_roastery_calibration`, which uses only the latest session; its numbers agree.
- **In the table:** `n` is the number of coffees with both values. A negative ρ would mean reversed.

| Roaster | Dimension | n | ρ (pooled) | ρ (calibration view) | Read |
|---|---|---|---|---|---|
| Joe Bean | Acidity | 7 | 0.45 | 0.61 | same direction |
| Joe Bean | Sweetness | 7 | **0.17** | 0.12 | weak: Indonesia 2 vs our 7.5, Brazil 5 vs our 12, Blossom 3 vs our 3.1 |
| Joe Bean | Bitterness | 7 | none | none | the roaster gave all seven a 3; our range runs 0.5 (Brazil) to 6.8 (Blossom). Not reversed, just flat. |
| Joe Bean | Body | 7 | 0.63 | 0.47 | same direction |
| Joe Bean | Finish | 7 | 0.90 | 0.85 | same direction |
| Joe Coffee | Acidity | 8 | 0.70 | 0.64 | same direction |
| Joe Coffee | Sweetness | 8 | 0.71 | 0.54 | same direction |
| Joe Coffee | Bitterness | 8 | 0.90 | 0.80 | same direction |
| Joe Coffee | Body | 7 | **0.34** | **−0.04** | weakest: Cafè Feminista 2 vs our 5.9, The Village 2 vs our 6.3, Nightcap Decaf 3 vs our 9.0 |
| Joe Coffee | Finish | 7 | 0.45 | 0.45 | same direction |
| both | Clarity, Mouthfeel | 0 | none | none | **cannot be checked:** A&B's sheet has no numbers for Savory / Depth or Texture on any of these coffees |

**What this says:**
- **No dimension on a map roaster runs opposite to our cupping** on pooled data.
- The calibration view's own "inverted" flag fires only for **Utopian** (Bitterness ρ −0.71, Body ρ −0.63, n 5). Utopian is deactivated and none of its coffees is on the map. That may be the reversed scale you remember.
- The nearest on the map is **Joe Coffee's Body**: ρ −0.04 on the latest session, 0.34 pooled. That is weak, not reversed.

**The one I'd watch: Mouthfeel (Silky → Grippy), both roasters.**
- It can't be checked against our cupping.
- Both roasters' Mouthfeel follows their own Body almost one for one:
  - Joe Bean gives 5 to Tiger Stripe, Blossom and Indonesia;
  - Joe Coffee gives 5 to Big City and 4 to Great Heights.
- That reads as "fuller", while the anchor's high end is "grippy" (drying, rough). A customer would read "Tiger Stripe: grippy".
- **Proposal:** hold Mouthfeel back for both roasters until we can check it. Show the other six.
- Clarity (Clean → Layered) looks consistent with its anchors (Benchmark 1, The Village 4; D.R. Congo 2, Blossom 4). Show it.

**Where the switch lives:** see item 1. Nothing is held back unless you say so at this STOP.

### Item 4: where it shines

- **The portal's wording:**
  - The question is **"Where it shines"** (`roastery-portal/copy.ts`, `whereItShines`), with a second question **"Also good as"**.
  - Customers would see the `where_it_shines` copy row, set to "Where it shines".
- **How it's stored:** one `best` (single choice) plus any number of `also_good`, with no order among them (first finding).
- **What it would show:** best first, then also-good in the lookup order. **Today's tag** shows the best one alone.

| Coffee | Today's tag | Where it shines (proposed) |
|---|---|---|
| Blossom | Batch brew / drip | Batch brew / drip · Espresso · French press |
| Brazil | Batch brew / drip | Batch brew / drip · Pour-over · Espresso · AeroPress |
| D.R. Congo | Pour-over | Pour-over · Batch brew / drip · Espresso · Cold brew |
| Fabricator | Batch brew / drip | Batch brew / drip · Pour-over · Cold brew |
| Geometric | Pour-over | Pour-over · Batch brew / drip · Espresso · Cold brew |
| Indonesia | French press | French press · Batch brew / drip · AeroPress |
| Tiger Stripe | Espresso | Espresso · Pour-over · Batch brew / drip · Cold brew |
| Amsterdam | French press | French press · Espresso · Moka pot |
| Benchmark | Batch brew / drip | Batch brew / drip · French press |
| Big City | French press | French press · Moka pot · Cold brew |
| Cafè Feminista | Pour-over | Pour-over · Batch brew / drip · AeroPress |
| Great Heights | Cold brew | Cold brew · French press · Moka pot |
| Half Moon | Batch brew / drip | Batch brew / drip · French press |
| La Familia | Pour-over | Pour-over · Batch brew / drip · Espresso |
| Nightcap Decaf | Batch brew / drip | Batch brew / drip · Espresso · French press |
| The Daily | Batch brew / drip | Batch brew / drip · French press · Moka pot |
| The Village | Pour-over | Pour-over · Batch brew / drip · Espresso · AeroPress |
| The Waverly | Espresso | Espresso · AeroPress · Moka pot |

### Item 5: what each of the 18 panels would show

- **Order:** description → where it shines → notes → the roaster's bars.
- **Notes** = the qualifying customer notes (`/flavor-wheel`).
- **Roaster bars:** six dimensions if Mouthfeel is held back, seven if not.
- **A&B bars:** today's cupping bars, which `/map` would no longer show.

| Coffee | Description | Where it shines | Notes | Roaster bars | A&B bars today |
|---|---|---|---|---|---|
| Blossom | yes | 3 methods | 4 | yes | 8 |
| Brazil | **no** | 4 | 1 | yes | 8 |
| D.R. Congo | **no** | 4 | 1 | yes | 8 |
| Fabricator | yes | 3 | 3 | yes | 8 |
| Geometric | yes | 4 | 5 | yes | 8 |
| Indonesia | **no** | 3 | 1 | yes | 8 |
| Tiger Stripe | yes | 4 | 7 | yes | 8 |
| Amsterdam | yes | 3 | 4 | yes | 8 |
| Benchmark | yes | 2 | 3 | yes | 8 |
| Big City | yes | 3 | 3 | yes | 8 |
| Cafè Feminista | yes | 3 | 3 | yes | 8 |
| Great Heights | **no** | 3 | 1 | yes | **0** |
| Half Moon | **no** | 2 | 1 | yes | **0** |
| La Familia | yes | 3 | 5 | yes | 3 |
| Nightcap Decaf | yes | 3 | 2 | yes | 5 |
| The Daily | yes | 3 | 3 | yes | 8 |
| The Village | yes | 4 | 5 | yes | 8 |
| The Waverly | **no** | 3 | 1 | yes | **0** |

- **After this brief, every one of the 18 has "More about this coffee",** because every one has roaster ratings.
- Today The Waverly, Great Heights and Half Moon have none.
- **Six coffees** (Brazil, D.R. Congo, Indonesia, Great Heights, Half Moon, The Waverly) open with no description (OT-182). Their panel starts at "Where it shines".
- **Acceptance cases:**
  - Great Heights, Half Moon and The Waverly have no A&B cupping but do have ratings, so they will show bars.
  - No map coffee lacks ratings, so "shows none" is a test fixture (sixth finding).

### Item 6: the panel's dimension names

- **The cupping sheet** (`coffee_dimensions`, what `/map` shows today, labels from the row):
  - Fragrance, Aroma, Flavor (faint–intense);
  - Sweetness (no sweetness–very sweet);
  - Acidity (flat–very bright / sharp);
  - Bitterness (none–very bitter);
  - Body (watery / light–very heavy);
  - Finish Length (disappears immediately–very long lingering);
  - Texture and Savory / Depth also exist on the sheet, but none of these 18 coffees has numbers for them.
- **The portal** (`roastery_portal_dimension`, what the roaster rated): Acidity (Soft–Bright), Sweetness (Low–High), Bitterness (Low–High), Body (Light–Full), Clarity (Clean–Layered; our Savory / Depth), Mouthfeel (Silky–Grippy; our Texture), Finish (Short–Lingering).
- **Overlap:** five dimensions are in both. Fragrance, Aroma and Flavor are ours only; Clarity and Mouthfeel are the roaster's names for two of ours.
- **Proposal:** a customer sees the portal's label and anchors, the words the roaster answered to, in the portal's own `sort_order`. Rows, not code.

### Small things

- **The panel's other headings** ("In the roaster's words", "See the notes wheel", "Cupping profile") are typed into `RevealedPanel` today. That predates this brief.
  - For `/map`, the brief puts its two new headings in copy rows.
  - I'd pass every `/map` heading as a prop from copy: the two new rows, plus `roaster_words_title` and `notes_title` for the two existing headings at their current wording.
  - The Bloom page keeps its typed headings, so its output stays byte for byte the same.
- **The award:** the "award-winning" inside Tiger Stripe's description (OT-180) still shows. This brief doesn't touch it.

### Calls needed before Part A

1. **Bars on their own 1 to 5 track,** not converted to 0 to 15 (first finding).
2. **Submitted, not accepted, decides the bars** (Big City, Nightcap Decaf and The Daily keep theirs).
3. **Where it shines** lists the best one first, then the also-good ones in the lookup order.
4. **Hold Mouthfeel back for both roasters,** or show all seven. If you hold it, I'd build the `roastery_portal_dimension_hold` table, view and writer, with the switch on the Calibration table. If you show all seven, nothing new is built.
5. **One new public route** (`/api/coffees/:id/roaster-profile`), plus `withRoasterProfile` on `useCoffeeDetail`. No new reader or view, apart from the hold, if you choose it.
6. **Laptop:** the open card spans both columns with its panel inside it, and the top card's panel spans the full width.
7. **Labels:** the portal's (Clarity, Mouthfeel, Finish, with their anchors); copy rows for the `/map` headings, two new plus two for the existing headings.

**STOP. Nothing has changed on either database or in the code.**

## Dana's answers at the STOP (2026-11-26)

1. Yes: 1 to 5 on its own track, not converted. Add a caption row: "Rated by the roaster, against their own coffees."
2. Yes: submitted answers decide the bars.
3. Yes: best method first, then the others in list order.
4. Hold Mouthfeel back for both roasters: `roastery_portal_dimension_hold`, its view and one writer, insert-only, the switch on the Calibration table; seed the two holds through the writer.
5. Yes to `GET /api/coffees/:id/roaster-profile` and the hook option, `/map` only; no roaster name or id in the response.
6. Yes to the laptop panel behaviour.
7. Yes to the portal's labels and the extra copy rows.

Plus OPEN_TASKS: Joe Bean's Bitterness is 3 on all seven; the ratings are not comparable across roasters.

## Parts A to D on the test DB (2026-11-26)

danab-0a confirmed idle before the build and stayed off the repo. Nothing is committed or pushed; production is untouched.

### A. Data

- `schema.sql`, new block "ELLA'S BLOOM MAP 13":
  - Table `roastery_portal_dimension_hold`: `id` SERIAL, `roaster_id`, `dimension_id` (→ `roastery_portal_dimension`), `reason`, `raised_by_uid`, `created_at`, plus the withdraw columns.
  - Partial unique index: one open hold per roaster and dimension.
  - Guard trigger: insert-only, with one withdraw; DELETE raises. `REVOKE DELETE, TRUNCATE` for `ab_app`.
  - View `v_roastery_portal_dimension_hold`.
  - Five copy rows, inserted if missing:
    - `where_it_shines`: "Where it shines"
    - `roaster_rates`: "How the roaster rates it"
    - `roaster_rates_caption`: "Rated by the roaster, against their own coffees."
    - `roaster_words_title`: "In the roaster’s words"
    - `notes_title`: "See the notes wheel"
- `comments.sql`:
  - The table, its columns and the view are commented.
  - The `dial_customer_copy` comment is rewritten to name the new codes; it stays under 1,000 characters.
- Seed `backend/src/scripts/ellaMapRoasterProfile_2026_11_26.ts`:
  - Dry run by default; `--apply`; `--expect-db`, defaulting to the test DB.
  - Writes the copy rows through `setCustomerCopyInTx`.
  - Holds Mouthfeel through `setDimensionHoldInTx` for each roaster with a coffee on the active map. Roasters come from the map, dimensions from their portal label; no roaster is named in code.
- On the test DB:
  - Schema and comments applied: 2,350 comments, 0 uncommented.
  - The seed wrote 2 holds, and a rerun wrote 0 (`backend/tmp/em13_apply_test*.md`).

### B. Backend

- Readers (`roasteryPortalReads`):
  - `listDimensionHolds(roasterId)`, for the admin switch.
  - `heldDimensionIdsForCoffee(coffeeId)`, for the `/map` read; it returns ids only.
- Writer: `roasteryPortalService.setDimensionHold` / `setDimensionHoldInTx`.
  - `hold: true` inserts and `hold: false` withdraws; both need a reason.
  - Idempotent. Refuses a dimension the portal doesn't ask.
- `roasterVoiceReads.getRoasterProfile(coffeeId)` composes the existing readers:
  - `getCurrentResponseForCoffee` and `getBrewLabels` give where it shines: best first, then also-good in lookup order.
  - `roasterFactsForCoffees` (`v_roastery_portal_coffee_hint`, latest submitted) gives the ratings.
  - Held dimensions are dropped.
  - `PORTAL_RATING_MAX = 5`, the CHECK on `roastery_portal_response_dimension.value`, is returned as `scale`.
- Routes:
  - `GET /api/coffees/:id/roaster-profile` → `{ whereItShines, scale, ratings: [{ label, lowLabel, highLabel, value }] }`. No roaster name or id, no respondent, no award.
  - Admin `GET`/`POST /api/admin/roastery-portal/roasteries/:roasterId/dimension-holds`.
- Lints:
  - `lint:lineage`, `lint:roastery-portal`, `lint:catalog`, `lint:customer`, `lint:retention` and `lint:cupping` are clean.
  - The seed reads portal data only through `roasteryPortalReads`, and its roasters through `v_coffee`.

### C. Frontend

- `MapPage.tsx`, from `lg`:
  - `main` widens to `max-w-6xl`.
  - The map and the top card sit side by side.
  - The steps run in two columns, with the lead section across both.
  - An open step card spans both columns.
  - The top card's open panel spans the page under the top row.
  - Below `lg`, the page is as before, with the top panel inside its card.
- `useMoreAbout`:
  - Reads through `useCoffeeDetail` with `withRoasterProfile: true` and `withDimensions: false`, so `/map` never reads A&B's bars.
  - `MoreAboutButton`, `MoreAboutPanel` and `MoreAbout` all render the one shared `RevealedPanel`; no second panel component.
  - The button shows only once the profile read is back, and only for a coffee with a description, ratings, or notes with a where-it-shines answer.
- `RevealedPanel`:
  - New optional prop `mapProfile`, field variant only.
  - It draws description → where it shines → notes → the roaster's bars, every heading from props (copy rows).
  - It never draws `dimensions` or `brewTags`.
  - Without the prop, the markup is unchanged.
- `DimensionBars`:
  - New optional `pointScale`, field variant only.
  - Each rating is one step on the 1 to `pointScale` track, with aria "Acidity: 4 of 5, from Soft to Bright".
  - Without the prop it is unchanged.
- `useCoffeeDetail`: option `withRoasterProfile`, default false.
- `bloomField.css`:
  - New classes `.bf-psec`, `.bf-shines` and `.bf-pcaption`.
  - `.bf-map-panel` gives two columns from 1024 px.
- Admin `CalibrationPanel`, new "On /map" column:
  - Each portal dimension shows shown or hidden, the reason, and a Hide/Show button that asks for a reason first.
  - Non-portal rows show "—".

### D. Tests

- `backend/src/services/dialMap13.test.ts`, 11 tests:
  - Where it shines: Tiger Stripe's list; on all 18 coffees, best first, then lookup order.
  - Ratings:
    - Six portal-labelled ratings, unconverted: Tiger Stripe 4, 4, 3, 5, 4, 4.
    - No Mouthfeel and no cupping-sheet names.
    - The Daily (submitted, not accepted) has bars.
    - A coffee with no portal answers has none.
  - The hold:
    - Hold, withdraw and idempotency.
    - Another roaster's hold doesn't reach this coffee.
    - The roaster's answers hash is unchanged.
    - The guard trigger; the refusals.
  - The seed: a rerun writes 0.
  - The route: its shape carries no roaster name or id; a bad id returns an empty profile.
- `mapMoreAbout.test.tsx`, 11 tests:
  - The panel's content:
    - Order of sections and headings from copy.
    - The methods list.
    - One-step bars on 1 to 5, with no "Cupping profile" and no `/dimensions` read.
    - Only the given dimensions are drawn.
    - No award, roaster or links.
  - When it shows:
    - No ratings means no bars or heading.
    - Ratings alone open a panel.
    - Notes without methods give no button.
  - Layout: one open at a time on the phone; the laptop placements.
  - **The Bloom page's panel markup is a snapshot written from the pre-brief `RevealedPanel`, `DimensionBars` and CSS; the new code matches it.**
- Runs:
  - Frontend: 193 of 193 (18 files).
  - Backend: dialMap13, comments.format, dialMap12 and the coffees route tests 42 of 42; dialMap10 and comments.db 13 of 13.
  - Frontend `tsc`: the 7 errors it had before this brief, none in a file touched here.

### Acceptance

Run locally, signed in as the marked Zzz test admins, on the test DB (`backend/tmp/em13_ui.mjs`, `em13_ui_out.json`).

- **1440 px** (`map13_laptop_dana.png`, `map13_laptop_p81.png`):
  - The map (528 px) is beside the top card (528 px).
  - The lead is 1,088 px across both columns; the other steps are 532 px each in two columns.
  - No horizontal scroll.
- **Panels at 1440 px:**
  - Tiger Stripe's top panel spans the page under the row (`map13_laptop_top_panel_open.png`).
  - An open step card is 1,088 px wide with its panel inside (`map13_laptop_step_panel_open.png`).
- **390 px** (`map13_phone.png`, `map13_phone_top_panel_open.png`):
  - One column, as before.
  - The panel sits inside the top card.
  - No horizontal scroll.
- **Tiger Stripe's panel**, in order:
  - "In the roaster’s words" and the description.
  - "Where it shines": Espresso, Pour-over, Batch brew / drip, Cold brew.
  - "See the notes wheel".
  - "How the roaster rates it", the caption, then Acidity 4, Sweetness 4, Bitterness 3, Body 5, Clarity 4, Finish 4, of 5.
- **All eight panels opened** on the two test accounts read in that order. None shows "Cupping profile", Mouthfeel or a link.
- **No cupping of ours, ratings shown:** The Waverly (on Dana's page) shows bars and starts at "Where it shines", since it has no description.
- **No portal ratings:** no map coffee lacks them, so this is shown in the tests only, as foreseen in Task 0.
- **The Bloom page:**
  - "Reveal the full profile" at 1440 px is byte-identical in a screenshot taken with the pre-brief files and with the new ones (`map13_bloom_panel_before.png` = `map13_bloom_panel_after.png`).
  - Its reads are content, flavor-wheel, hops and dimensions, never `/roaster-profile`.
- **Words on `/map`:**
  - No roaster name, compatibility sentence or comfort-zone label.
  - **One hit, "award":** it is the "award-winning blend" inside Tiger Stripe's own description (OT-180, already open). This brief doesn't touch it.
- **The switch** (`map13_admin_calibration.png`):
  - On Joe Bean's Calibration table, Show on /map, with a reason, put Mouthfeel back in Tiger Stripe's read. Hide on /map took it out again.
  - Test DB now: holds #2 and #6 are open, one for each map roaster.
  - #1 and #5 were withdrawn by the acceptance runs; #3 and #4 were rolled-back test inserts.
- **Clean-up:** the test admins are disabled again and the local servers are stopped.

### Notes for Dana

- **The scale number:** now the row `dial_roaster_rating_max` (fix 3 below).
- **The `/map` panel no longer reads A&B's cupping at all.** Coffees with our cupping no longer show our bars there; the Bloom page still shows them.

## Three fixes (Dana, 2026-11-26, after the report), on the test DB

1. **Notes as a plain line.**
   - The `/map` panel's notes are now one line under a "Notes" heading (new copy row `notes_heading`), before the ratings. The line is `teaserFor`, the collapsed card's notes sentence, e.g. "Almond, Chocolate, Peanuts, with cherry, apple and dried fruit".
   - "See the notes wheel" is a link beside the heading that opens the wheel in place.
   - The Bloom page's panel is unchanged (its snapshot still passes).
2. **Coffee names clear of family names.**
   - On the customer face (`EllaMapFace` with `quietOthers`, `/map` only), the family names and the centre's name are placed first, and each coffee name takes the first spot that covers none of them. On Dana's page, "The Waverly" moved to the left of its dot, off "Chocolate & Nutty".
   - The admin map never takes that branch. The label positions now come from named constants with the same values as before, so its markup is unchanged: a snapshot written from the pre-fix face matches.
   - `mapFace.test.tsx` uses the test DB's real map (`__fixtures__/face_2026-11-26.json`). Each of the 18 coffees as the customer's, with arrows to its family, gives no overlap. The pre-fix face fails this test, including on Dana's case.
3. **The scale's top is a row.**
   - New evidence parameter `dial_roaster_rating_max` = 5, inserted if missing by `schema.sql`; its note says it must match the table's CHECK.
   - Read by `roasterVoiceReads.roasterRatingMax`, through the existing `evidenceReads.getParameters`. A missing row gives 0, and then no bars are drawn.
   - Added to the map integrity check's parameter keys, with the six copy codes.
   - `PORTAL_RATING_MAX` is gone.

**Runs:**
- Frontend: 197 of 197 tests (19 files); `tsc` still has the 7 errors it had before this brief, none in a file touched here.
- Backend: 43 of 43 (dialMap13 now 12, comments.format, dialMap12, coffees); 15 of 15 (dialMap10, comments.db, dataCatalogIntegrity).
- All six lints are clean.
- Test DB: schema and comments applied (0 uncommented); a seed dry run plans 0 writes (8 unchanged).
- A local look at 1440 px confirmed both visual fixes.

### Before the push

1. Confirm with danab-0a that no other session is running.
2. Commit only this brief's files. Leave out `usual_drink/README.md`, `commerce/CLOSING_REPORT_6.md`, the Genova font deletions and the untracked briefs.
3. Push. Production then boots `schema.sql` (the table, the view and the five copy rows) and `comments.sql`.
4. Production seed: dry run, `--apply --expect-db axisandbloom`, then a rerun that should write 0.
5. Check `/api/coffees/2914/roaster-profile` and two `/map` pages on production; run `catalog:md` and commit CATALOG.md.

Dana said push (2026-11-26).
