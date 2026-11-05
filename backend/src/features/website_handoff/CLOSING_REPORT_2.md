# Closing report: Website 2 (presentation data the handoff needs)

Brief: `CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md`. Date: 2026-11-04.

## Task 0 (read-only; written before any change)

Read: `DEVELOPMENT_GUARDRAILS.md`, `CLAUDE.md`, the workstream `README.md`, `HANDOFF_SURVEY_2026-11-04.md`, `CATALOG.md` (generated 2026-11-01), the coffee presentation closing reports 1 to 4, `roasterVoiceReads.ts`, `roasteryPortalReads.ts`, `catalogReads.ts`, `commerceParameters.ts`, `routes/coffees.ts`, `usePositionCardData.ts`, `AdminCatalog.tsx`, and the handoff HTML (`source/homepage-data/index.html`, `source/shop/build.py`). Data read with `BEGIN READ ONLY` on the test DB and on prod.

**Verdict: nothing contradicts the brief's goal.** Five findings change *how* a field is sourced (each one is a question the brief told Task 0 to answer), so no STOP. They are marked ⚑ below and repeated under "Deviations".

### 1. CATALOG.md check, per object

| Handoff field | Existing object found | Fits? | What this brief does |
|---|---|---|---|
| Family three words | `coffee_archetype` (`description` is a sentence; no words column) | no column | add `coffee_archetype.customer_words text[]`, CHECK cardinality 3 |
| Family read path | ⚑ `v_coffee_archetype` already is the one archetype read view (`catalogReads.getArchetypes`, 14 readers) | **yes** | append `customer_words` to `v_coffee_archetype`; **no `v_archetype_presentation`** (it would be a twin of `v_coffee_archetype`, G2.5 one reader path, G2.14) |
| Family colour / tints | not in the DB (frontend `bloomVisuals` / `theme.css`) | n/a | the view omits colour, as the brief allows |
| Best brew / Also good | `roastery_portal_response_brew`, read by `roasterVoiceReads` (labels from lookup `roastery_portal_brew_method`, `other` left out) | yes | reused through `roasterVoiceReads` (G3.9), no SQL copy |
| Milk | ⚑ the portal **does** ask it: `roastery_portal_response.takes_it` (black / milk / both). Prod: 22 of 27 current responses answered (3 black, 16 both, 3 milk) | as evidence, yes | new lookup `coffee_milk_recommendation` (`without` / `either` / `with`) with a `portal_takes_it` column mapping each to the portal answer (the mapping is data, G2.1). The card shows A&B's editorial choice (`coffee_presentation`) first, else the roaster's latest **submitted** answer. Handoff's "Works both ways" is the portal's `both` |
| One-line hint | `v_roastery_portal_coffee_hint` is **not** a customer hint: it is the roaster's latest submitted answers (proposed family, dominant dimension, 1-5 values) for the admin match. `coffees.three_voice_story` is the full description | no | `coffee_presentation.hint` (new) |
| Leads in cup | ⚑ two sources: the roaster's `dominant_dimension_id` (portal, latest submitted; 17 of 19 linked active coffees on prod) and the pooled ranges (`v_coffee_dimension_range`). Camila's three real cards ("Sweetness", "Sweetness", "Body") are exactly the portal answers for 2917, 2914, 2916 | yes | derived in `v_coffee_card`: roaster's submitted answer first (D9), else the highest pooled midpoint among the dimensions the portal asks about (`roastery_portal_dimension.is_active`), tie by `display_order`. Shown as `platform_name` else `name` (so Body reads "Intensity", the site's word) |
| Origin | `coffees.origin_region_id` → `lookup_value` (`origin_region`) | yes | read in `v_coffee_card`. ⚑ **Prod: 0 of 22 active coffees have a region set**, so the Origin row is absent on every card until Dana sets regions in admin (existing door: `catalogService.updateCoffee`) |
| Premium ★ | award = count of current `topic = 'award'` remarks (`roasterVoiceReads.getCardTags`, lookup `coffee_card_tag`/`award`) | yes | reused; the card carries `hasAward: boolean` only, never the remark or the tag label |
| Photo | nothing | no | `coffee_presentation.photo_asset_key` (NULL until Camila supplies one) |
| Quotes | in code (`Home.tsx QUOTES`, 6 old quotes); nothing in the DB | no | `marketing_home_quote` (new). `marketing_config` is a URL key/value store keyed on a natural PK with no order or active flag, so it does not fit |
| Featured slot | `commerce_parameter` (history, Range/Format, admin card) | yes | key `home_featured_slot`, text `archetype_code:sort_order`, seeded from the C&N landing-default slot (prod: slot 23, "Coado", sellable at 12 oz, $32.00). New text format `dial slot` added to `commerceParameters` so the admin card can edit it |
| Facts | `quiz`/`quiz_type`/`quiz_question`, `v_coffee_dimension_range`, `coffee_archetype` | yes | computed, see 1a |

Why `coffee_presentation` is a new table and not columns on `coffees`: `coffees` is the roaster-facing master with 14 declared writers; the presentation is A&B's editorial layer over it (the decision-beside-evidence split, G2.12), with one writer.

Why `v_coffee_card` is a new view: no existing view holds presentation, milk, leads-in-cup and origin per coffee. `v_coffee` is the identity model read by 8+ views; `v_coffee_customer_descriptor` is one row per descriptor. ⚑ Grain: **one row per active coffee** (not per sellable slot): the Shop's Other section needs category coffees that have no slot (prod: 2 decaf coffees), and the slot/price/winner rule already lives in TS (`buildSlotsForArchetype`), so the view carries the coffee facts and the service joins them to slots.

#### 1a. The three facts on prod

| Fact | Rule | Prod value | Handoff |
|---|---|---|---|
| questions | current questions of the active main quiz | **6** (v7) | 07 |
| dimensions | numeric dimensions with a pooled range on at least one active coffee | 8 | 08 |
| families | `coffee_archetype.is_archetype` | 5 | 05 |

⚑ The handoff's "07 Questions" (and "Take the 7-question quiz") does not match: the live main quiz has 6 current questions; 3 of the 5 families add a 1-question branch, so a customer answers 6 or 7. The brief's rule (main quiz count) gives 6, which is also the count the live quiz's progress shows. Kept as the brief says; Dana to confirm the copy in brief 3.

### 2. What the frontend card already receives

`GET /api/coffees/archetypes` → per slot: `dialSortOrder, positionLabel, description, isActive, platformName, isDefault, prices[{weightOz, retailPriceCents, label, isAnchor}], coffeeId`; per family: `archetype, archetypeLabel, dimension*, doors, collectionOffer{memberCount, sumCents, discountedCents}`. `usePositionCardData` then fetches per coffee `/content` (`threeVoiceStory, process, roastLevel, originRegion, tags[{kind: award|brew, label}]`), `/hops`, `/flavor-wheel` (the signature line comes from these rows via `teaserFor`), `/dimensions` (on reveal), and `/api/shop/slot-availability` per weight. **Missing for the handoff card:** customer words, hint, also-good brews, milk, leads in cup, photo key, award as a boolean, signature notes as words in one payload, and the whole thing in one call per page.

### 3. `comments.sql` writers today

- `coffee_archetype`: `catalogService.setArchetypeDescriptorFamilies; seed`. The words column is written by `seed` only (no admin door in this brief → OPEN_TASKS).
- `coffees`: 14 writers (unchanged; this brief writes nothing on it).
- `commerce_parameter`: `commerceParameters.setParameterInTx; seed` (unchanged; one seed row added).
- Format: `Purpose | Class | Writer | Readers | Since`; columns one sentence; ≤ 1,000 characters per comment (format test).

### 4. Lineage impact (`lint:lineage`)

| Table | Writer declared | New writer module in code |
|---|---|---|
| `coffee_presentation` (new) | `catalogService.setCoffeePresentation` | `catalogService` only |
| `coffee_milk_recommendation` (new) | `seed` | none |
| `marketing_home_quote` (new) | `seed` | none |
| `coffee_archetype` | unchanged set (`catalogService…; seed`) | none new (words are seeded in `schema.sql`) |
| `commerce_parameter` | unchanged | none new |

No table gains a second writer module.

### Other things noticed (not changed here)

- `GET /api/coffees/other-categories` falls back to the coffee's **raw name** (`coffees.name`, "never shown to customers") when a category coffee has no home slot; both prod decaf coffees (2909, 2930) have none today. The new card payload does **not** do this: `platformName` is the home slot's name or null. Logged for brief 4.
- The card's brew tags read the portal's *current* response (an open draft wins over the last submitted version: existing `getCurrentResponseForCoffee` behaviour, kept for G3.9). Milk and leads-in-cup read the latest *submitted* answer. Logged in OPEN_TASKS.

## What was built

- **Schema** (`schema.sql`; idempotent, applied twice by the test `globalSetup` with no error): `coffee_archetype.customer_words` (+ CHECK cardinality 3, seeded only where NULL), `coffee_milk_recommendation` (3 rows), `coffee_presentation`, `marketing_home_quote` (8 rows), `commerce_parameter.home_featured_slot` (`chocolate_nutty:2`, Format: dial slot), `v_coffee_card`, `v_coffee_archetype.customer_words`. `v_coffee_card` is also pre-dropped with the evidence views so a second boot never meets it as a dependent of the portal hint view.
- **Reads:** `services/coffeeCardReads.ts` (the card), `services/homeContentReads.ts` (facts, quotes, featured). `buildSlotsForArchetype`, `computeCollectionOfferFromSlots` and the other-categories list moved there unchanged from `routes/coffees.ts`, which imports them back (G3.9).
- **Writer:** `catalogService.setCoffeePresentation` (one door; a `catalog_change` row per real change; an unchanged save writes nothing).
- **Endpoints:** `GET /api/coffees/cards`, `GET /api/home/content` (new `routes/home.ts`), `customerWords` on `GET /api/coffees/archetypes`, admin `GET`/`PUT /api/admin/catalog/coffees/:id/presentation`.
- **Frontend:** `getCoffeeCards`, `getHomeContent` and their types in `lib/api.ts`; `ArchetypeData.customerWords`; the admin coffee Edit modal's "Customer card" block (hint, milk, photo key; the card's milk source, leads in cup and origin shown read-only). No page changes.
- **Docs:** `WHAT_WE_BUILT.md` #252, `WHAT_WE_BUILT_DB.md` As-of line, `OPEN_TASKS.md` OT-69…OT-73, `REGRESSION.md` section, `comments.sql`; `CATALOG.md` after the deploy.

## Evidence (test mode, `axisandbloom_test`)

| Check | Result |
|---|---|
| New tests `services/websitePresentation.test.ts` | 15 / 15 pass |
| Full suite (`--no-file-parallelism --exclude 'dist/**'`) | 1,128 tests: 1,121 pass, 7 fail = the 6 known OT-19 `quizScoring` + 1 stale assumption in `schema.catalog_blueprint.test.ts` (a legitimate "no band" cupping signal from 2026-10-25, test DB row 29; unrelated to this brief, logged OT-73, G1.12) |
| Lints `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage` | all exit 0 |
| Backend `tsc --noEmit` | clean |
| Frontend `tsc --noEmit` | 10 errors, all pre-existing, none in a touched file; `vite build` green; frontend `npm test` 13 / 13 |
| Local backend boot on the test DB | `[data-catalog]` 155 tables, 77 views; findings only #4 (CATALOG.md stale, expected before regeneration) and #6 (the 25 pre-existing dead candidates; no new table among them) |

`GET /api/home/content` on the local backend (test DB):

```json
{ "facts": { "questions": 6, "dimensions": 8, "families": 5 },
  "quotes": ["You have no idea what you’ll get. It’s hard to explain taste with words.", "… 8 in all"],
  "featured": { "card": { "archetype": "chocolate_nutty", "dialSortOrder": 2, "platformName": "Coado", "isActive": false, "…": "…" }, "price": null } }
```

(No C&N coffee is placed on test, so the featured slot is unsellable there and `price` is null, which is the right state.)

`GET /api/coffees/cards` (test DB): five families in order, each with its words (`floral` Bright/Fragrant/Delicate … `earthy` Deep/Bold/Lasting), `collectionOffer` null everywhere (no family has 3 sellable slots on test), `other` 2 cards. One card:

```json
{ "dialSortOrder": 1, "positionLabel": "Delicate", "isActive": true, "platformName": "Light Floral Edge",
  "prices": [{ "weightOz": 12, "retailPriceCents": 2900, "label": "12 oz", "isAnchor": true }],
  "coffeeId": 2903, "archetype": "floral", "archetypeLabel": "Floral",
  "signatureNotes": ["Citrus Fruit", "Other Fruit"], "bestBrew": "Pour-over", "alsoGood": ["Batch brew / drip", "Espresso"],
  "milk": "Best black", "leadsInCup": "Complexity", "hasAward": false }
```

No `hint`, `originRegion` or `photoKey` key: none exists yet, so the card omits the row.
