# Brief: Website 2 — presentation data the handoff needs (family words, coffee spec fields, home facts/quotes/featured slot)

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster, catalog discipline applies · **Mode:** test, then push · **Depends on:** nothing (can run before or after brief 1). Briefs 3, 4, 5 read what this brief exposes.

Read first: `README.md` (D5, D9, D10, D12, D13), `HANDOFF_SURVEY_2026-11-04.md` §1–3, `DEVELOPMENT_GUARDRAILS.md`, `CLAUDE.md` data-catalog rules, `CATALOG.md`, `backend/src/features/coffee_presentation/` (briefs 1–4 and closing reports: what the customer may hear about a coffee), `backend/src/features/roastery_portal/` (what roasters already answered).

## Goal

Everything the handoff types in as content exists as data, read through one view and one endpoint per surface, so briefs 3–5 type nothing in:

1. **Per family** (`coffee_archetype`): the three words shown under the family name ("Bright · Fragrant · Delicate"), the family's page tint set (`ink`, `t40`, `t60`, `t80` as derived from the family colour, computed in one place), and the family number (`sort_order`, exists).
2. **Per coffee (customer card)**: signature notes (exists), one-line hint, best brew (exists, portal), also-good brews (exists, portal), milk recommendation, "leads in cup" (derived: the coffee's dominant dimension from its reconciled ranges), origin region (exists, `origin_region_id`), award tag (exists), prices (exist). Plus a coffee photo key (string into the asset registry; NULL until Camila supplies one).
3. **Home**: the "In numbers" facts (computed), the survey quotes (seeded lookup), the "This week" featured slot (parameter).

**Decisions already made (do not re-open):** D9 fields and their sources · D10 numbers computed, quotes a table, featured slot a parameter · D12 Premium ★ = award tag · D13 prices from pricing tables · D14 no roasting or delivery promises. The README's "Data gaps" table is the field list; Task 0 confirms each row.

**Guardrails.** Read before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `commerce_parameter` or the parameter table Task 0 names) · G2.2 surrogate id PK on every new table · G2.3 prefix: `coffee_` for coffee/family presentation, `site_` is NOT used; home content goes under a prefix Task 0 proposes after reading CATALOG.md (candidate `marketing_` since `marketing_config` exists) · G2.4 CATALOG.md checked (why nothing fits: stated in Task 0 per object) · G2.5 one writer (`catalogService` for coffee/family fields; seed for quotes), reads via `v_coffee_card` (new) and `v_archetype_presentation` (new) · G2.7 vocabularies are lookup tables (milk recommendation) · G2.8 idempotent schema, seeds `ON CONFLICT DO NOTHING` · G2.11 reference content retired, not deleted · G2.17 comments.sql → catalog:md · G3.1 routes call services · G3.9 reuse `catalogReads`/`cuppingReads`, do not fork · G1.6 push is deploy. Mode: test. STOP points: none (no production data write beyond seeds that insert only if missing).

## Task 0 — verify first (read-only; findings into `CLOSING_REPORT_2.md`)

1. In `CATALOG.md`, for each handoff field, find the existing object and column that already holds it, or state why none fits:
   - family words → `coffee_archetype` (has `description`; no words column) · best / also-good brew → `roastery_portal_response_brew` + `v_roastery_portal_current_response` · milk → does the portal ask it? (`roastery_portal_response*` columns) · hint → check `v_roastery_portal_coffee_hint` (name suggests a portal-side hint; report what it is) and `coffees.three_voice_story` · leads in cup → `v_coffee_dimension_range` / `coffee_archetype.dominant_dimension_id` · origin → `lookup_value` category `origin_region` · award → wherever `CardTags` reads it · photo → nothing (new) · quotes → nothing (new) · featured slot → `commerce_parameter` (text/int parameter with Range) · facts → `quiz_question` current count for the main quiz, `coffee_dimensions` active count, `coffee_archetype` where `is_archetype`.
2. Read `usePositionCardData` and the endpoints it calls; list exactly which fields the frontend card already receives (`platformName`, `positionLabel`, `teaser`, `tags`, `prices`, `dimensions`…), so the new view adds only what is missing.
3. Read `comments.sql` header format and the `Writer:` lines for `coffee_archetype`, `coffees`, `commerce_parameter`.
4. Report the lineage impact (`npm run lint:lineage`) of each proposed writer.

If an existing column already carries a field, use it; do not add a twin (G2.14).

## Task 0.5 — Dana's manual steps

None. The three family word triples and the eight quotes come from the handoff HTML (`source/homepage-data/index.html` family panels; the `quotes` array in its script) and are seeded as the first values; Dana edits them later in the admin where a door exists.

## Part A — schema (idempotent, additive)

- `coffee_archetype`: add `customer_words text[]` (exactly three, CHECK `cardinality = 3` where not null) · seed from the handoff for the five archetypes, NULL for experimental.
- `coffee_presentation` (new, one row per coffee, `id SERIAL PK`, `coffee_id UNIQUE FK coffees`): `hint text`, `milk_recommendation_id FK → coffee_milk_recommendation` (new lookup: `id`, `code UNIQUE`, `label`, `customer_label`; seed: `without`, `either`, `with`), `photo_asset_key text` (registry key), `created_at/updated_at`. Writer: `catalogService.setCoffeePresentation` (one door). Why not a column on `coffees`: `coffees` is the roaster-facing master with its own writer set; presentation is an A&B editorial layer (same reasoning as the catalog decision layer, G2.12). State this in comments.
- `marketing_home_quote` (new, `id SERIAL`, `quote text`, `sort_order int`, `is_active bool`, `source text` default `survey`): seed the eight handoff quotes `ON CONFLICT DO NOTHING` on a UNIQUE(quote). Writer: seed (admin door later).
- `commerce_parameter` row (or the parameter table Task 0 names): `home_featured_slot` (archetype code + sort_order, or a `coffee_dial_slot` id) seeded to the Chocolate & Nutty default slot. No fulfilment-promise text anywhere (D14).
- `comments.sql` lines for every new/altered object (`Purpose | Class | Writer | Readers | Since`).

## Part B — views and endpoints (one read path each)

- `v_archetype_presentation`: `code, name, sort_order, is_archetype, description, customer_words, colour (from the existing source the frontend uses, if any is in the DB; otherwise the frontend keeps colours in `bloomVisuals` and this view omits it)`.
- `v_coffee_card`: one row per sellable slot coffee with everything the card shows: platform name, archetype code, dial sort order + position label, signature notes (reusing `v_coffee_customer_descriptor` rules: roaster's words first), hint, best brew, also-good brews (array), milk customer_label, leads-in-cup dimension name (derived), origin region label, award flag (boolean only, never the name), photo key, prices (join the pricing view the card already uses). Reuse the existing readers' logic; do not duplicate business rules in SQL that already live in `cuppingReads`/`catalogReads` — if the rule lives in TS, the view exposes the raw columns and the service composes.
- Endpoints (routes call services, G3.1): `GET /api/coffees/cards` (all five families + other, grouped, with the collection price per family computed from the pricing tables and the existing collection discount parameter) · extend `GET /api/coffees/archetypes` with `customer_words` · `GET /api/home/content` returning `{ facts: {questions, dimensions, families}, quotes[], featured: {slot card, price} }`. Admin: extend the existing coffee admin door with hint / milk / photo key (reuse `AdminCatalog` edit form; one new PATCH that calls `setCoffeePresentation`).
- Lineage: declare every writer/reader in `comments.sql`; `lint:lineage` green.

## Part C — frontend

Only the API client functions in `lib/api.ts` (`getCoffeeCards`, `getHomeContent`) and the `ArchetypeData` type extension. No page changes here.

## Part D — tests (vitest, test DB)

Seeds idempotent (run twice, same rows) · `v_coffee_card` returns NULL hint/milk for a coffee with no presentation row and the card endpoint omits the key · award exposed as boolean only · collection price equals the discount rule · facts counts match direct queries · `setCoffeePresentation` is the only writer.

## Acceptance

Local backend on the test DB: `GET /api/coffees/cards` and `/api/home/content` samples in the closing report; `npm run catalog:md -- --expect-db axisandbloom` after deploy, `CATALOG.md` committed; boot log `[data-catalog]` clean.

## Docs and closing

`WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md` "As of" line, `CATALOG.md` regenerated, `REGRESSION.md`, `OPEN_TASKS.md` (admin editor for quotes and words if not built here), `CLOSING_REPORT_2.md`.

## Do not

- No field typed in the frontend; no roaster name or award name in any customer payload.
- No twin columns for facts that exist (G2.14); no CHECK-list enums for milk (lookup table, G2.7).
- No deletes; retire with `is_active`.
