# Axis & Bloom — Database Reference

All database schema, table groups, views, enums, dimensions, session data, and useful queries. Read alongside `WHAT_WE_BUILT.md` (full project log) and `SOMMELIER_BUILT.md` (sommelier feature).

Schema file: `backend/src/db/schema.sql` — runs on every backend startup, fully idempotent.  
Migration scripts: `backend/src/db/migrations/`  
Seed files (run manually): `backend/src/db/seeds/`

---

## Database Schema (68 Tables)

The schema runs automatically on every backend startup (`CREATE TABLE IF NOT EXISTS` — fully idempotent, safe to run repeatedly).

> **As of 2026-06-29**: 60 tables. Path Coffee Roasters (13 coffees) + Temecula Coffee Roasters (16 coffees) fully seeded via Tasks 1–6. Run seed files from `backend/src/db/seeds/` in order via Cloud SQL Studio.

It was merged from the original Supabase design plus adaptations for Firebase Auth (Firebase UID used as the user identifier instead of Supabase's auth.users). The cupping tool tables (added May 2026) are a separate group with SERIAL PKs rather than UUIDs.

### Table groups

**Lookup / reference**
- `user_type` — subscriber, admin, roaster partner, etc.
- `archetype` — named flavor profiles: Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy, Experimental. **Application-layer key bug fixed 2026-07-13** (Find My Flavor Part 1, `WHAT_WE_BUILT.md` #91) — `backend/src/routes/users.ts` derived a lookup key via `archetype.name.toLowerCase()` (e.g. `"Chocolate & Nutty"` → `"chocolate & nutty"`), which never matched the `archetype_enum` values (`chocolate_nutty`, `balanced_sweet`, `earthy`, etc.) used everywhere else in the schema/API. No data was wrong — this was purely a code-side key mismatch, silently mis-serving 3 of 6 archetypes' color/features/`.id` on `GET /api/users/profile` and `/homepage-state`. Fixed with an explicit name→`archetype_enum` map.
- `roaster` — drop-ship roastery partners
- `quiz` — quiz versions
- `cupping_note` — SCA Coffee Taster's Flavor Wheel: 84 descriptors across 9 categories and ~25 subcategories; `intensity_score` is NULL by default (assigned per cupping session, not at descriptor level). **Sensory Source Provenance (2026-07-13)** added `descriptor_source_id` (all 84 rows → `wcr_lexicon`) and `lexicon_section`, linking every descriptor to its WCR Sensory Lexicon attribute — see `sensory_source`/`sensory_lexicon_attribute` below.
- `lookup_value` — controlled vocabulary for admin dropdowns: `category` + `value` + `label` + `sort_order`; seeded across 5 categories (`roast_level`, `process`, `blend_or_single`, `brew_method`, and `origin_region` added 2026-07-12 — 8 broad geographic buckets, e.g. "East Africa," shown publicly on the Flavor Intelligence page in place of the exact `origin` string); `ON CONFLICT DO UPDATE` so labels/order stay current on every deploy without duplicating rows. Also admin-editable at runtime as of 2026-07-12 via `POST/PATCH/DELETE /api/admin/lookups` — new values no longer require a code deploy. **`origin_region` value `central_south_america` added 2026-07-14** — for single-origin coffees (`blend_or_single = 'single'`) whose roastery-provided origin string itself spans two regions (e.g. "Central/South America"), distinct from `multi_origin` (actual blends only). Reflects the roastery's own label directly rather than forcing an inaccurate bucket — see `coffees` below.

**Users**
- `household` — shared account grouping (one household, multiple members)
- `household_invitation` — pending/accepted/cancelled invitations to join a household; token-based (32-byte hex); expires in 7 days; `ON DELETE CASCADE` from household; status: `pending`, `accepted`, `cancelled`
- `user_profile` — core user record; `firebase_uid` is the join key from Firebase Auth; columns added: `first_name TEXT`, `last_name TEXT`, `date_of_birth DATE` (all idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- `user_email` — multiple email addresses per user
- `user_phone`
- `address` — shipping and billing addresses (street, city, state, postal_code, country, is_default, address_type: `address_type_enum`); collected from the profile page Settings tab; first address of each type auto-set as default
- `user_payment_detail` — Stripe customer links and payment info

**Flavor / archetype engine**
- `archetype_vector` — where each archetype sits in flavor-dimension space
- `archetype_relationship` — which archetypes are adjacent/complementary
- `archetype_tunable_variable` — dials users can adjust within their archetype
- `user_vector_state` — where each user sits in flavor-dimension space (declared + behavioral)
- `user_archetype_tuning` — user's personal adjustments to their archetype
- `user_coffee_profile` — their ranked archetype matches

**Blends / roastery**
- `roaster_blend` — sellable package variant of a coffee (12oz / 5lb); links to Shopify variant IDs, roaster SKU, cost, inventory columns. Now has `coffee_id INTEGER REFERENCES coffees(id)` linking it to the tasting catalogue, and `last_restocked_at TIMESTAMPTZ` for manual restock tracking. A name-match backfill in `schema.sql` auto-populates `coffee_id` on startup; unmatched rows (flavored coffees etc.) are surfaced in Admin → Supply & Inventory for manual assignment.
- `roastery_blend_vector` — where each blend sits in flavor-dimension space
- `user_roaster_link` — roastery staff accounts
- `roaster` — drop-ship roastery partners; fields: name, contact_person, email, phone, address, website, api_endpoint, avg_fulfillment_hours, roaster_notes, is_active; new contact fields added May 2026

**Quiz**
- `quiz_type` — lookup: `'main'` (user-facing quiz) | `'branch'` (reclassification sub-quiz); FK on `quiz.quiz_type_id`
- `quiz` — branch quizzes are rows with `quiz_type = 'branch'`, `trigger_archetype_id` (which primary archetype fires this branch), and `parent_quiz_id` (self-referential FK to the main quiz). No separate link table needed. `quiz_branch` was dropped in #54.
- `quiz_question` — (renamed from `question` in #55) includes `weight NUMERIC DEFAULT 1`; question-level multiplier applied uniformly to all answers in that question
- `quiz_answer` — (renamed from `answer` in #53) branching logic via `next_question_id`, vector impact stored as JSONB; includes `weight NUMERIC DEFAULT 1` and `is_experimental_gate`; shared by both main and branch quizzes
- `quiz_answer_archetype_score` — the scoring matrix: one row per (quiz_answer, archetype); `score` is the archetype-specific impact (positive or negative); `archetype_id = NULL` = neutral answer (no points); UNIQUE on `(answer_id, archetype_id)`
- `quiz_session` — a user's completed quiz
- `quiz_vector` — dimension scores from a quiz session

**Orders & fulfillment**
- `subscription` — recurring delivery schedules
- `order` — purchase records; links to Shopify order IDs. **As of #73 (2026-07-07), this is the live write path** — `POST /api/orders` now inserts here instead of the legacy hand-created `orders` (plural) table, which was never actually exercised (every checkout attempt failed at the Shopify step before reaching it). Also gained shipping snapshot columns: `shipping_street`, `shipping_city`, `shipping_state`, `shipping_postal_code`, `shipping_country`, `shipping_address_id` — the address is copied onto the order at checkout time rather than live-referencing `address`, so a later address edit/delete never rewrites what a past order actually shipped to.
- `roastery_shipment_details` — tracking info per order
- `order_line_item` — individual blend quantities per order

**User lifecycle status** *(added #73, 2026-07-07 — business/marketing classification, Cloud SQL; decoupled from the Sommelier's Firestore conversation-scoping state)*
- `user_lifecycle_stage` — reference/lookup table, same pattern as `lookup_value`; `code` (e.g. `QUIZ_TAKEN_FRESH_NO_ORDER`), `label`, `description`, `sort_order`, `homepage_enabled`, `is_active`; seeded with 9 rows: `NEW_NO_QUIZ`, `QUIZ_TAKEN_FRESH_NO_ORDER`, `QUIZ_TAKEN_SETTLED_NO_ORDER`, `QUIZ_STALE_NO_ORDER`, `FIRST_ORDER_FEEDBACK_PENDING`, `ACTIVE_REPEAT_USER`, `SUBSCRIBER`, `REORDER_DUE`, `LAPSED_SINGLE_ORDER`. **`FIRST_ORDER_FEEDBACK_PENDING` deactivated as of #74** (`is_active = false, homepage_enabled = false`, row kept for FK history) — pending feedback turned out to need to coexist with a user's real standing stage (a subscriber can still have an unanswered feedback ask), so it became an independent flag (`getPendingFeedbackOrder()` in `userLifecycle.ts`) instead of a mutually-exclusive stage.
- `user_lifecycle_state` — current state, one row per user (`user_id` PK), `stage_id` FK, `computed_at`; cheap indexed read at pageview time via `GET /api/users/homepage-state`
- `user_lifecycle_event` — append-only history, one row per stage *change* (not every recompute); `from_stage_id` / `to_stage_id` / `transitioned_at`; for funnel and cohort analysis (e.g. "% of `QUIZ_TAKEN_FRESH_NO_ORDER` users reaching a first order within 14 days")

No enforced sequence between stages — a user can land on any stage directly from any other, so this is a flat classification re-evaluated from current facts each time (`refreshLifecycleState()` in `backend/src/services/userLifecycle.ts`), not a state-transition graph.

**Intelligence**
- `notification_log` — email/SMS notifications sent
- `user_feedback_event` — ratings, repurchases, skips used to tune recommendations
- `user_recommendation_log` — AI recommendation audit trail

**Chat & newsletter**
- `chat_message` — Claude AI chat history per user
- `subscriber_source` — normalised reference table for signup origins; 4 seeded rows: `pre_launch` (Pre-Launch Popup), `newsletter` (Newsletter Modal), `post_quiz` (Post-Quiz Signup), `footer` (Footer Widget)
- `newsletter_subscriber` — `email` PK; `first_name TEXT`; `source_id` FK → `subscriber_source`; `user_id` FK → `user_profile` (optional, now populated by `POST /api/newsletter/subscribe` via `optionalAuth` when the caller is signed in — was always nullable but never actually set before this); `subscribed BOOLEAN`; `created_at`. **Extended 2026-07-20/21** (`WHAT_WE_BUILT.md` #110, launch/10_quiz-and-archetypes Step 04): `archetype TEXT`, `experimental BOOLEAN`, `confidence TEXT`, `quiz_session_key TEXT` — all nullable, populated when the signup originates from the post-quiz firm email gate (`COALESCE(new, existing)` on conflict, so a later non-quiz signup never wipes a captured quiz result, but a quiz retake's new archetype does overwrite the old one). Feeds Step 05's Mailchimp personalization without a second lookup.
- `quiz_funnel_event` — **added 2026-07-20** (`WHAT_WE_BUILT.md` #109, launch/20_analytics-and-tracking Step 02). First-party quiz funnel logging, source of truth over GA4/Pixel since `POST /api/quiz/score` is public and guests dominate. `session_key TEXT` (client-generated `crypto.randomUUID()`, not a FK — most rows are guests), `event TEXT` CHECK'd to `quiz_start`/`quiz_complete`/`email_submitted`, `archetype TEXT` (nullable, populated on `quiz_complete`), `created_at`. Indexed on `session_key` and `created_at`. Written via `POST /api/quiz/event` (rate-limited, handler in `backend/src/features/marketing/funnelEvents.ts`).

**Cupping tool** *(added May 2026 — SERIAL PKs, standalone from the main schema)*
- `coffees` — coffee catalogue (name, roaster, origin, process, roast level/shade, roaster flavor descriptors). `origin_region_id INTEGER REFERENCES lookup_value(id)` added 2026-07-12, nullable — broad geographic bucket for the exact `origin` string (which stays server-side only, never in a public API response). Backfilled by hand for all 29 current coffees; not auto-derived from `origin` (ambiguous free text). **Re-verified 2026-07-13** (Flavor Intelligence Part 9, prompted by a report that every coffee showed "Multi-Origin / Blend"): queried directly against production — distribution is real and varied (13 Multi-Origin/Blend, 6 East Africa, 4 South America, 4 Central America, 3 Southeast Asia & Pacific), matching the original backfill. Per-coffee data was never actually broken. **Root cause found 2026-07-13**: `chocolate_nutty` is the first archetype in `/api/coffees/archetypes`' response order, and its default-selected slot (no coffee there currently carries a working `isDefault: true` — see the known `is_default` data mismatch noted under Sommelier/Bloom Dial work) falls back to whichever active slot sorts first, which resolves to Noam Blend ("Classic Chocolate") — a coffee whose ambiguous `origin` ("Central") had been classified `Multi-Origin / Blend` in the original backfill. Every guest landed on this exact coffee on first page load, every time, regardless of the (correct, varied) data everywhere else. **Fixed**: reclassified Noam Blend to `Central America` — the alternative Part 1's own backfill notes had already flagged as equally defensible ("the roastery's own label says 'Central,' not 'multi-region'"). Verified directly against the live production API. This was the one coffee among the original ambiguous judgment calls (Noam Blend / Crosshatch / Feather In Cap) with a genuinely defensible non-blend alternative; the other two legitimately span two disparate regions and correctly remain `Multi-Origin / Blend`.

**Second report, 2026-07-14**: Dana found the same "Multi-Origin / Blend" mislabel in the Earthy archetype. Diagnosis differed from the Noam Blend case: Earthy's only two catalogue coffees, **Nocturnal Dark Roast** and **Vantablack Ultra-Dark** (both Path Coffee Roasters), are `blend_or_single = 'single'`/`'single origin'` — genuinely not blends — but their roastery-provided `origin` string is `"Central/South America"`, spanning two of the seven original buckets with no single defensible pick. Audited every other coffee still tagged `Multi-Origin / Blend`: all of them are `blend_or_single = 'blend'`, correctly classified — these two were the only mislabeled outliers. **Fixed**: added a new `origin_region` value, `central_south_america` → "Central & South America" (seeded in `schema.sql`, not just live-patched), reflecting the roastery's own label directly instead of forcing it into the blend bucket or omitting it. Assigned to both coffees; verified against the live production API.
- `cupping_sessions` — session header (date, brew_method TEXT, location, notes); brew_method was originally `brew_method_enum` but migrated to `TEXT` so it accepts all lookup values (cupping, pour-over, etc.) without enum constraint failures
- `cupping_session_coffees` — junction: which coffees appeared in a session and in what order
- `coffee_dimensions` — cupping dimension catalogue, 12 seeded rows; `is_numeric = true` → scored 0–15 with scale labels; `is_numeric = false` → free-text notes only. **`platform_name`** *(added The Bloom Part 3)* — consumer-facing word per dimension, same alias pattern as `coffee_alias.platform_name`; `COALESCE(platform_name, name)` at the query level where unset. Seeded for the 5 numeric dimensions currently in play: Acidity→Brightness, Bitterness→Boldness, Body→Intensity, Savory / Depth→Complexity, Finish Length→Finish. Sweetness/Texture left null (already plain English); the free-text dimensions aren't used for dial/bar axes. Direct-SQL-only — no dimension admin UI exists yet. **`source_id`/`sensory_lexicon_attribute_id`** *(added Sensory Source Provenance, 2026-07-13)* — which standard defines this axis (`sca_cva` for the aroma/flavor-phase dims + Acidity + Finish Character, `wcr_lexicon` for Bitterness/Body/Texture/Finish Length/Mouthfeel, `platform` for Savory/Depth) and, where one WCR attribute applies, a link to it — see `sensory_source`/`sensory_lexicon_attribute` below.
- `cupping_scores` — per-taster score header (session_coffee_id, taster_name, is_merged, overall_notes); unique on `(session_coffee_id, taster_name)`; `is_merged = true` for the combined row
- `cupping_score_values` — one row per (cupping_score, dimension); `value_min` / `value_max` for numeric dims, `notes` for free-text dims; unique on `(cupping_score_id, dimension_id)`
- `cupping_score_descriptors` — structured flavor notes: links a score row to one or more SCA wheel descriptors (`cupping_note`) instead of free text; `intensity` (0–15) captures how prominent the descriptor was; `custom_notes` is an escape hatch for off-wheel descriptors; unique on `(cupping_score_id, cupping_note_id)`. **`intensity` is `NULL` for all 47 rows in production as of 2026-07-13** — `AdminCupping.tsx` has always had the input, it's just never been used. See `OPEN_TASKS.md` OT-12: the Flavor Intelligence page's descriptor bars originally scaled bar *length* by this field (Part 4) and went uniform as a result; Part 6 moved length to `mentions` (real data, works today) and demoted `intensity` to bar *thickness* only, so this gap now just means every bar renders at one neutral default thickness instead of varying — a smaller, cosmetic-only impact.
- `roastery_coffee_descriptors` — structured version of `coffees.flavor_descriptors_roaster TEXT[]`; **one row per descriptor per coffee** (e.g. Crosshatch with 3 bag notes = 3 rows); links to SCA wheel via FK; unique on `(coffee_id, cupping_note_id)`
- `user_flavor_feedback` — post-delivery feedback from customers; **one row per descriptor per user per coffee** (e.g. a client who tasted Blueberry and Dark Chocolate = 2 rows); links user + coffee + order to SCA wheel descriptors; `intensity` optional; no session or brew params — lightweight by design. Write path shipped in WHAT_WE_BUILT.md #100 — `POST /api/orders/:orderId/feedback` v2's tasted-note chips, validated server-side against that coffee's own distinct notes in `v_collaborative_flavor_wheel`
- `cupping_brew_params` — brew parameters per session-coffee (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device); all nullable

**Sensory source provenance** *(added 2026-07-13 — records where each sensory term/scale comes from; non-destructive, only new tables + nullable columns on `cupping_note`/`coffee_dimensions`)*
- `sensory_source` — registry of the standards in play: `wcr_lexicon` (World Coffee Research Sensory Lexicon 2.0, 2017 — source of the flavor vocabulary), `sca_flavor_wheel` (SCA Coffee Taster's Flavor Wheel, 2016 — source of our `wheel_category`/`wheel_subcategory` grouping, not the words), `sca_cva` (SCA Cupping Form CVA Descriptive Assessment, 2023 — basis for the 0–15 `coffee_dimensions` scale), `platform` (Axis & Bloom internal — consumer-facing aliases with no external standard). 4 rows.
- `sensory_lexicon_attribute` — full WCR Lexicon reference set, 113 rows (109 unique attribute names across the lexicon's 17 sections; `Sweet`/`Sour`/`Bitter`/`Salty` are intentionally cross-listed once under "Taste Basics" and once under their own section, per WCR's own structure — `UNIQUE(name, section)` allows both). Kept as a *separate* reference table rather than expanding `cupping_note`, so the active 84-descriptor flavor wheel stays clean while the full ~110-attribute WCR set is still queryable with provenance. `wheel_category`/`wheel_subcategory` is a best-effort mapping onto the same taxonomy `cupping_notes_sca_wheel.sql` uses (`NULL` for Amplitude/Mouthfeel-section attributes — those are WCR/CVA-only constructs with no SCA wheel placement; they instead feed `coffee_dimensions` via the link below). `cupping_note_id UUID REFERENCES cupping_note(id)` links to an active descriptor where one exists — all 84 current descriptors are linked, via an explicit mapping (not a bare name join, since a few WCR names are ambiguous across sections or need an alias: `Overripe`→"Overripe / Near-fermented", `Brown`→"Brown-Roast", `Roast`→"Roasted"). `definition` is left `NULL` by design — WCR's lexicon text is copyrighted (personal-use license), so only attribute names/sections are stored; fill from the PDF manually if desired. Seed: `backend/src/db/seeds/sensory_lexicon_attributes_wcr.sql` (run manually, same convention as `archetype_vectors.sql`) — also backfills `cupping_note.descriptor_source_id`/`lexicon_section` and `coffee_dimensions.sensory_lexicon_attribute_id`.
- Full feature spec + verification queries: `backend/src/features/sensory-source-provenance/` (`CLAUDE_CODE_PROMPT.md`, `SOURCES.md`, `verify.sql`). Two bugs found in the original spec draft and corrected during implementation: `cupping_note.id` is `UUID` not `INT` (the spec's FK type was wrong), and `cupping_note`'s wheel columns are `wheel_category`/`wheel_subcategory` not `category`/`subcategory` (the spec's own verify checksum query used the wrong names).
- Verified directly against production Cloud SQL: before/after md5 checksums of `cupping_note` and `coffee_dimensions`' original columns matched exactly (non-destructive), all 84 `cupping_note` rows linked with 0 unmatched, all 12 `coffee_dimensions` sourced, re-running schema.sql + the seed produced identical counts (idempotent). See `WHAT_WE_BUILT.md` #92.
- `archetype_assignments` — archetype tag per coffee with confidence level; `superseded_at = NULL` for the current assignment, populated when a newer one replaces it
- `coffees.ai_summary TEXT` — AI-generated tasting note cached in the DB (added via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); generated once on first public page load, updated only via admin refresh; never regenerates on visitor traffic

**Bloom Dial** *(added June 2026; reorg + suggestion/adjacency #75, priority-swap/validation/suggestions follow-up #76, categories decoupling #78, Coffees page cleanup #79, 2026-07-09/11)*
- `dial_archetype_config` — dominant dimension and Bloom Dial flag per archetype (seeded, 6 rows as of #75). `is_archetype BOOLEAN` (added #75) — `true` for the 5 real flavor families, `false` for `experimental` (a cross-cutting category, not a peer archetype — see `BLOOM_DIAL_ALLOCATION_SPEC.md` §3). Suggestion (below) and archetype-adjacency logic check this flag. **As of #79**, also drives the frontend directly — new `GET /api/admin/archetypes` (`dial_archetype_config` joined to the `archetype` table's human labels) replaced a hardcoded frontend list; `is_archetype` splits `AdminCoffees.tsx`'s matrix rendering (`renderArchetypeSection`, shared by both) into an "Archetypes" section (`is_archetype = true`) and a "Categories" section (`is_archetype = false` — today just `experimental`, which still gets its own position/alias table there since it still owns real `dial_archetype_positions`/`coffee_alias` data, unlike the plain-tag categories). **`experimental` assignment via `POST /api/admin/coffees/:id/archetype` was briefly rejected outright as of #78, then restored the next day** — that guard turned out to block the only mechanism that places a coffee into the "Experimental" table at all (it's still driven by `archetype_assignments`, not `coffee_category`), so assignment stays allowed; only the display grouping changed.
- `dial_position_vocabulary` — archetype+dimension-specific label vocabulary for the Bloom Dial (seeded, 24 rows — 4 per archetype × 6 archetypes); experimental uses dimension 9 (Savory/Depth), labels: Curious / Adventurous / Daring / Untamed. `label` is editable via `PATCH /api/admin/dial/vocabulary/:id` (click-to-edit on the "Position" column, Coffees page).
- `dial_archetype_positions` — maps coffees to their position on the Bloom Dial per archetype; single source of truth for position, exclusively writable from the Coffees admin page (arrows, edit form, and the #75 suggestion Apply button all go through `PATCH /api/admin/dial/positions/:id`, which now swaps with any coffee already occupying the target slot — same archetype + roaster — instead of silently overwriting, #75). **As of #93**, gained `is_guest BOOLEAN NOT NULL DEFAULT false` + `dap_guest_not_default CHECK (NOT (is_guest AND is_default))` — a coffee's `is_guest=false` row is its one home position (owned exclusively by `POST /api/admin/coffees/:id/archetype`, which now touches only that row on a re-tag); every other row is a "seam" guest position welding it onto an adjacent archetype's dial, written only via the new `POST`/`DELETE /api/admin/dial/positions/guest[/:id]`, never `is_default`, never a separate SKU. `coffee_alias` and `blendResolver.ts` are guest-blind by construction (all their `dial_archetype_positions` joins/lookups filter `is_guest = false`) — a guest slot can never be allocated for fulfilment.
- `dial_coffee_relationships` — directional dimensional hop graph between coffees; feeds the sommelier RAG and, as of #75, also feeds `v_archetype_adjacency` and the within-archetype `hop_conflict` cross-check against the cupping-based suggestion (below) — no longer Liam-only. As of #76, `POST /api/admin/dial/relationships` hard-rejects archetype/hop-type contradictions before insert (same coffee twice, missing archetypes, `within_archetype` across different archetypes, `bridge_archetype` within one) and soft-warns (doesn't block) when the claimed `direction` contradicts real cupping data or an opposite-direction hop already exists for the pair. **As of #78**, gained nullable `from_category_id`/`to_category_id` (`REFERENCES coffee_category(id)`) plus `CHECK` constraints (`chk_from_endpoint`, `chk_to_endpoint`) requiring exactly one of {coffee, category} per side — a hop can now be coffee↔coffee (unchanged default), coffee↔category, or category↔category. New `hop_type_enum` value `category_hop` for these. Category-hop creation is SQL-only for now, no admin UI/API — **as of #93**, `POST /api/admin/dial/relationships` explicitly hard-rejects `hop_type='category_hop'` rather than silently letting one through with unset category columns. **As of #93**, the graph itself was populated for the first time beyond the 3 Session-001 coffees: 46 navigable rows (Dial Turns + Bridge Hops, including 2 secondary-dimension bridge rows for the quiz-branched CN↔Earthy and Fruity↔Floral seams) plus the 2 `category_hop` rows (Bali Blue ↔ Experimental).
- `coffee_category` *(added #78)* — cross-cutting categories orthogonal to archetype: `code`, `label`, `description`, `sort_order`, `is_active`, `is_hoppable`. Seeded with 4 rows (`experimental`, `decaf`, `half_caf`, `flavored`); only `experimental` has `is_hoppable = true`. Admin-extensible via `POST /api/admin/categories` (Coffees page "Categories" section) — `is_hoppable` is never client-settable, stays a manual DB decision. **As of #79**, also deletable outright via `DELETE /api/admin/categories/:id` (not just deactivatable) — `coffee_category_assignment` rows cascade automatically; a category still referenced by a `dial_coffee_relationships` hop (no cascade there, by design) is blocked with a `409` instead of a raw FK error.
- `coffee_category_assignment` *(added #78)* — many-to-many join, `UNIQUE(coffee_id, category_id)`. No FK to `archetype_assignments`/`dial_archetype_positions` — a coffee can have a category with no archetype, an archetype with no category, both, or neither. Mechanically backfilled for 6 known coffees (Kopi Safari→Experimental, Decaf→Decaf, Sleepwalker Half-Caf→Half-Caf, Vanilla/Hazelnut/Chocolate→Flavored) — their actual archetype is still an open cupping/tasting decision, not backfilled. Managed via `GET`/`POST`/`DELETE /api/admin/coffee-categories` and per-coffee checkboxes in `AdminCoffees.tsx`'s `EditForm`.
- `dial_position_signal` *(added #75)* — one row per source's opinion about a coffee's dial position (`cupping`, `roastery_wheel`, `client_wheel`, `sms_feedback`, `onsite_feedback`). `cupping` rows are superseded (not deleted) via `recordCuppingSignal()`, called from `POST /api/admin/scores` after a merged-score save — same pattern as `archetype_assignments`. `onsite_feedback` rows are **appended** instead (WHAT_WE_BUILT.md #100, `POST /api/orders/:orderId/feedback` v2's "lighter/as expected/bolder" question) — each submission is an independent customer observation, not a recomputed estimate of the same measurement, so multiple rows accumulating for `v_dial_position_consensus` to weigh is the correct model here. `sms_feedback`/`roastery_wheel`/`client_wheel` still unpopulated. Never auto-writes to `dial_archetype_positions`.
- `cupping_note_dimension_weight` *(added #75, empty by design)* — table shape only for a future descriptor→dimension mapping (e.g. Citrus → Acidity → more); intentionally has zero rows until there's enough cupping volume to validate a mapping against real scores.
- `dial_source_weight` *(added #75)* — reliability weight per signal source: `cupping=3`, `sms_feedback`/`onsite_feedback=1`, `roastery_wheel`/`client_wheel=0` (zero until `cupping_note_dimension_weight` has validated content).
- `dial_slot_price` *(added #80, The Bloom Part 1)* — retail price per Bloom Dial slot (`archetype`, `dial_sort_order`) per `weight_oz`; `UNIQUE(archetype, dial_sort_order, weight_oz)`. Named to group with the rest of this `dial_*` family (renamed from an earlier `slot_price` draft). Not on `coffee_alias` (no weight dimension) or `roaster_blend` (would let two roasters fulfilling the same slot show two prices for the same weight). Defaults applied at the query level when no row exists yet: `$38.00`/12oz, `$199.00`/5lb (80oz). Managed via `GET`/`PATCH /api/admin/slot-prices` and a two-price edit control in `AdminCoffees.tsx` next to Slot Name; publicly read (roaster-blind) via `GET /api/coffees/archetypes`.
- `coffee_retail_price` *(added #95)* — the coffee-keyed counterpart to `dial_slot_price`, for coffees with no dial position (Decaf/Half-Caf/Flavored/Experimental — Bloom Dial Base Data Part 3, Phase 6): `(coffee_id, weight_oz, retail_price_cents)`, `UNIQUE(coffee_id, weight_oz)`. `roaster_blend` has no retail price column (only `cost_to_us`), which is why this couldn't just reuse that table. Same default-at-query-level convention as `dial_slot_price`. Managed via `GET`/`PATCH /api/admin/coffee-prices` (no admin UI wiring yet, API only); publicly read (roaster-blind) via `GET /api/coffees/other-categories`. Resolved via `resolveCoffeeBlend(coffeeId, weightOz)` in `blendResolver.ts` — the coffee-keyed counterpart to `resolveBlendForSlot`, no priority-fallback chain (one specific product, not a multi-roaster slot).
- `user_bloom_dial_current_position` *(added #83, The Bloom Part 3, as `user_bloom_dial_position`; renamed #102)* — a signed-in user's remembered Bloom Dial position per archetype: `(user_id, archetype)` PRIMARY KEY, `dial_sort_order`. Deliberately its own table, not a repurposing of `user_archetype_tuning`/`archetype_tunable_variable` — those are reserved for a different, computed, feedback-derived confidence/offset signal, even though the key shape coincidentally matches. Uses `archetype_enum` directly to match the rest of this `dial_*` family. Managed via `GET`/`PATCH /api/users/dial-position` (`requireAuth`); `BloomDialWidget.tsx` pre-sets to the saved position on load and auto-saves on every real snap (drag or hop-triggered), no-ops for guests. Renamed in #102 (Liam Dial Event Log) once `users/{uid}/dial_events` (Firestore) existed as a separate *intentional-movement* history alongside it — this table stays pure continuity state, silently overwritten, no history; see its own `COMMENT ON TABLE`. **A deploy-ordering race briefly left an empty duplicate `user_bloom_dial_position` (0 rows) sitting alongside this table in production** — an older build's `CREATE TABLE IF NOT EXISTS` ran at a moment the old name had already been vacated by the rename. Confirmed empty via direct query before dropping it; the rename DO block's guard was also hardened (checks the target name doesn't already exist too) so a recurrence degrades to a silent no-op instead of hard-failing and aborting the rest of that boot's schema migration.

**`backend/src/services/dialSuggestion.ts` — shared query helpers *(refactored #76)***
- `getAvgCuppingScore(coffeeId, dimensionId)` — a coffee's merged cupping average + session count on one dimension; `null` if no merged scores exist. Single source for this query, used by `getDialSuggestion`, the within-archetype `hop_conflict` check, hop-creation direction validation, and the hop-suggestion endpoint (previously 3 near-duplicate inline queries).
- `getArchetypeBucketWidth(archetype, dimensionId)` — `(target_max - target_min) / N` from `v_archetype_dimension_comparison` and `dial_position_vocabulary`; the same "is this delta big enough to matter on this archetype's own scale" threshold `getDialSuggestion` uses internally, now reusable — `GET /api/admin/dial/hop-suggestions` (#76) uses it to decide whether a cupping-score delta between two same-archetype coffees is worth suggesting as a Dial Turn hop.

**Roastery catalogue** *(seeded June 2026)*
- `coffee_alias` — maps Axis & Bloom platform slot names (e.g. "Classic Balanced", "Jammy & Aromatic") to the coffees that fill them; `priority=1` = Path (preferred), `priority=2` = TCR (fallback); `archetype` is NULL for Half-Caf / Decaf rows; UNIQUE on `(archetype, dial_sort_order, coffee_id)` — NULL archetypes bypass the constraint so multiple NULL rows are allowed; see `seeds/coffee_alias_path_tcr.sql`. **As of #75**, `archetype`/`dial_sort_order` are superseded columns — `GET /api/admin/coffee-alias` derives both live from `dial_archetype_positions`/`archetype_assignments`, falling back to these stored columns only when a coffee has no live position. Priority/rank is now edited from the Coffees admin page, not Blends & SKUs; new alias rows are created via `POST /api/admin/coffee-alias` (also #75). **As of #94**, keeps only its fulfilment role (coffee↔slot mapping, `priority`, `is_active`) — `platform_name` here is legacy/unread; the display name now lives on `dial_slot_alias` (below).
- `dial_slot_alias` *(added #94)* — the single source of truth for a Bloom Dial slot's display name: `(archetype, dial_sort_order, platform_name)`, `UNIQUE` on both the slot key and the name. A slot's name is a property of the slot, never of whichever coffee currently occupies it — fixes a regression where two coffees at different positions could share a name, and a coffee's name went stale when it moved slots (#93's spread moves). Seeded with 20 flavor-slot names + 1 Experimental-slot name (`ON CONFLICT DO NOTHING`, safe to re-run). Every public/admin reader that shows a slot name joins here; `PATCH /api/admin/coffee-alias/slot` and `PATCH /api/admin/coffee-alias/:id` (rename) both upsert here (`409` on a duplicate name). **As of #96**, also joined by `sommelierRag.ts`'s `getAliases()` (Liam's catalog-name source) and `GET /api/admin/inventory` — both were missed in #94's initial rollout and were citing stale/duplicate `coffee_alias.platform_name` values until fixed. **As of #97**, rounded out to 24 rows total — the 3 remaining unnamed experimental slots (1/3/4) seeded ("Curious Start"/"Daring Edge"/"The Wild Card"); new `GET /api/admin/dial/slot-aliases` returns all 24 unconditionally for the admin matrix (unlike `GET /coffee-alias`, which only has rows for occupied slots).

**Sommelier (Liam)** *(added June 2026 — SERIAL PKs)*
- `sommelier_sessions` — one row per Liam session; columns: `uid TEXT` (firebase UID), `intent TEXT`, `turn_count INT`, `is_closed BOOL`, `close_reason TEXT`, `context_data JSONB` (stores catalogText, evaluationId, archetype, coffeeIds, ragFocus), `last_active_at TIMESTAMPTZ`
- `sommelier_messages` — **legacy** (table kept, no longer written). Conversation messages moved to Firestore `users/{uid}/sommelier_sessions/{sessionId}/messages` as of 2026-06-27. `GET /api/sommelier/:id/messages` falls back to this table for sessions created before the migration.
- `user_tokens` — token balance per user; PK is `uid TEXT` (firebase UID); columns: `balance INT DEFAULT 0`, `lifetime_earned INT DEFAULT 0`, `lifetime_spent INT DEFAULT 0`. **This is the source of truth for token balance** — `GET /api/users/profile` reads it directly from Postgres. The `tokenBalance` field mirrored onto Firestore `users/{uid}` is a read-side cache only (written by `tokenService.ts` after every grant/spend) — editing it manually in the Firebase console has no effect on the site.
- `token_events` — full audit trail of every earn and spend; columns: `uid TEXT`, `delta INT` (positive=earn, negative=spend), `reason TEXT`, `reference_id TEXT`, `created_at TIMESTAMPTZ`
- `liam_sms_feedback` — legacy alias for `sommelier_sms_feedback`; one row per SMS message (outbound + inbound); tracks scheduling, delivery, reply parsing, and Firestore doc link
- `sommelier_sms_feedback` — one row per SMS message; outbound rows track scheduling (`scheduled_for`, `sent_at`, `delivery_status`); inbound rows store reply, parsed sentiment, rating, descriptors, and `firestore_feedback_doc_id`; idempotency key: `(user_id, blend_id)`; `reply_to_id` links inbound → outbound

---

### Views

| View | Description |
|---|---|
| `v_collaborative_flavor_wheel` | All descriptor observations per coffee with source label (`internal`, `roastery`, `client`). Columns: `coffee_id`, `coffee_name`, `cupping_note_id`, `wheel_category`, `wheel_subcategory`, `descriptor`, `source`, `intensity`. No extra JOINs needed — names are already resolved. One row per observation; GROUP BY coffee + descriptor to aggregate. |
| `v_quiz_scoring_matrix` | Full scoring matrix — one row per (quiz_question, quiz_answer, optional archetype). Includes all questions across all quiz versions: main, branch, and Q6 (food signal, weight 0, no score rows). Columns: `quiz_version`, `quiz_type`, `q_number`, `q_text`, `a_number` (ROW_NUMBER), `answer_text`, `q_weight`, `ans_weight`, `resulting_archetype` (the archetype the answer maps to), `scored_archetype` (the archetype scored — NULL for Q6 and branch answers), `ans_score`. Lambda formula: `q_weight × ans_weight × ans_score`. Built from `quiz_answer` with LEFT JOINs to `quiz_answer_archetype_score` so zero-score answers still appear. Uses `DROP VIEW IF EXISTS` + `CREATE VIEW`. |
| `v_newsletter_subscribers` | All newsletter signups with human-readable source label. Columns: `email`, `first_name`, `source` (e.g. `Pre-Launch Popup`), `subscribed`, `signed_up_at`. Ordered newest first. |
| `v_archetype_vectors` | Archetype dimension targets — one row per archetype × dimension. Columns: `archetype`, `dimension`, `display_order`, `min_score`, `ideal_score`, `max_score`. Joins `archetype_vector` to `archetype` (FK) and `coffee_dimensions` (via `md5(name)::uuid`). Public read via `GET /api/axis/vectors` (built for The Axis page); **as of #84** also the real source for `/coffees` and `/bloom`'s "this coffee has more/less X than your usual archetype" compatibility text (`frontend/coffee-info/archetypeVectors.ts`) — replaced a hardcoded frontend approximation of this same data. |
| `v_archetype_dimension_comparison` | Target vs actual — same as `v_archetype_vectors` plus `avg_actual` (average of actual cupping scores for coffees assigned to that archetype) and `coffee_count`. Bridges `archetype_enum` → `archetype.name` via CASE. `avg_actual` is NULL for archetypes with no cupping data yet. |
| `v_dial_positions` | Current coffee positions on each archetype's Bloom Dial. Columns: `archetype`, `coffee`, `roaster`, `origin`, `dimension`, `position_sort`, `dial_label`, `has_bloom_dial`, `is_default`, `is_guest` (added #93), `delta_from_default`, `is_computed`, `last_computed_at`. Joins `dial_archetype_positions` → `coffees`, `dial_position_vocabulary`, `coffee_dimensions`, `dial_archetype_config`. |
| `v_dial_navigation` | Directional hop graph between coffees. Columns: `from_coffee`, `to_coffee`, `dimension`, `direction` (`more`/`less`), `hop_type` (`within_archetype`/`bridge_archetype`), `delta`, `is_recommended`, `confidence`, `notes`. Joins `dial_coffee_relationships` → `coffees` (×2), `coffee_dimensions`. |
| `v_archetype_adjacency` *(added #75)* | Cross-archetype bridge-hop summary, derived live from `dial_coffee_relationships`. One row per unordered archetype pair with ≥1 `bridge_archetype` hop between coffees currently tagged with those archetypes (filtered to `dial_archetype_config.is_archetype = true` on both sides). Columns: `archetype_a`, `archetype_b`, `hop_count`, `more_count`, `less_count`, `avg_confidence` (`confidence_enum` low/medium/high mapped to 1/2/3 and averaged). Shown on the Bloom Dial admin page (`AdminDial.tsx`). **As of #84**, also publicly read via `GET /api/axis/adjacency` — the real source for `/coffees` and `/bloom`'s "Worth exploring" compatibility badge tier (`frontend/coffee-info/archetypeAdjacency.ts`), replacing a hardcoded frontend adjacency map. Currently sparse (one real pair, `balanced_sweet ↔ floral`) — the separate `archetype_relationship` table is confirmed unused (0 rows), this view is the real source of truth for archetype adjacency now. |
| `v_dial_position_consensus` *(added #75, dormant)* | Weighted rollup of current (`superseded_at IS NULL`) `dial_position_signal` rows per `(coffee_id, archetype)`, weighted by `dial_source_weight.reliability_weight`. Columns: `coffee_id`, `archetype`, `consensus_vocabulary_id` (weighted mode; ties take the highest-weighted single source), `total_sample_size`, `weighted_sample_size`. With only `cupping` weighted above zero today, this mirrors the live Phase 3 suggestion. Read-only, not wired into any frontend page. |
| `v_subscribers_weekly` *(added launch Step 06, 2026-07-22)* | Weekly new-subscriber counts by source. Columns: `week` (date, week start), `source` (`subscriber_source.label`, `'Unknown'` if unset), `new_subscribers`. From `newsletter_subscriber` LEFT JOIN `subscriber_source`. Feeds the Looker Studio marketing dashboard. |
| `v_quiz_funnel_weekly` *(added launch Step 06, 2026-07-22)* | Weekly quiz funnel from `quiz_funnel_event`. Columns: `week`, `starts`, `completes`, `emails_submitted`, `completion_rate` (%, `completes/starts`), `optin_rate` (%, `emails_submitted/completes`). |
| `v_archetype_distribution` *(added launch Step 06, 2026-07-22)* | Subscriber count and share by archetype, from `newsletter_subscriber.archetype` (rows with a NULL archetype excluded). Columns: `archetype`, `subscriber_count`, `share` (%). |
| `v_orders_weekly` *(added launch Step 06, 2026-07-22)* | Weekly order volume/revenue from `"order"`. Columns: `week`, `orders`, `new_customers` (first-ever order landing in that week), `revenue_cents`. Returns zero rows gracefully pre-launch (no orders yet). |

**Reporting views paper trail — corrected 2026-07-23**: the SQL for all four views (plus the `reporting_ro` role) was committed the same day it was built, in `backend/src/db/schema.sql` (commit `5d99e94`) — it runs idempotently on every backend startup like every other view in this file, same as the rest of the table above. `backend/src/db/migrations/reporting_views_2026_07_23.sql` was added afterward on the mistaken premise that the SQL had never been committed (it's a byte-exact dump of the live production definitions, harmless and idempotent, but redundant with `schema.sql`) — kept as-is rather than deleted, but **`schema.sql` is the actual source of truth**; if the two ever drift, `schema.sql` wins since it's the one that actually runs.

### Roles

| Role | Purpose |
|---|---|
| `reporting_ro` *(added launch Step 06, 2026-07-22)* | Read-only Postgres role for the Looker Studio connector. `LOGIN`, `CONNECT` on the database, `USAGE` on schema `public`, `SELECT` on exactly the four `v_*_weekly`/`v_archetype_distribution` reporting views above — no base tables, no other views. Password lives in Secret Manager (per the Step 06 spec), not in any committed file. Defined in `backend/src/db/schema.sql` (also mirrored in `backend/src/db/migrations/reporting_views_2026_07_23.sql`, a redundant paper-trail copy — see note above). |

---

### Dimensions (seeded, 12 rows)

| ID | Name | Type | Scale |
|---|---|---|---|
| 1 | Fragrance | Free-text | — |
| 2 | Aroma | Free-text | — |
| 3 | Flavor | Free-text | — |
| 4 | Sweetness | Numeric | 0 (no sweetness) → 15 (very sweet) |
| 5 | Acidity | Numeric | 0 (flat) → 15 (very bright / sharp) |
| 6 | Bitterness | Numeric | 0 (none) → 15 (very bitter) |
| 7 | Body | Numeric | 0 (watery / light) → 15 (very heavy) |
| 8 | Texture | Numeric | 0 (very smooth / silky) → 15 (very drying / rough) |
| 9 | Savory / Depth | Numeric | 0 (transparent / clean) → 15 (very deep / complex) |
| 10 | Finish Length | Numeric | 0 (disappears immediately) → 15 (very long lingering) |
| 11 | Finish Character | Free-text | — |
| 12 | Mouthfeel | Free-text | — |

---

### Enums

| Enum | Values | Used by |
|---|---|---|
| `brew_method_enum` | `filter`, `espresso`, `cold_brew`, `other` | Defined but no longer used as a column type — `cupping_sessions.brew_method` was migrated to `TEXT` |
| `archetype_enum` | `chocolate_nutty`, `balanced_sweet`, `fruity`, `earthy`, `floral`, `experimental` | `archetype_assignments.archetype` |
| `confidence_enum` | `low`, `medium`, `high` | `archetype_assignments.confidence` |
| `address_type_enum` | `shipping`, `billing` | `address.address_type`; migrated from `TEXT` via idempotent `DO` block on deploy |
| `hop_direction_enum` | `more`, `less` | `dial_coffee_relationships.direction` |
| `hop_type_enum` | `within_archetype`, `bridge_archetype` | `dial_coffee_relationships.hop_type` |

---

## Coffee Catalogue (seeded 2026-06-29)

Seed files in `backend/src/db/seeds/` — run in order via Cloud SQL Studio. Not added to schema.sql (not idempotent).

| File | Table | Description |
|---|---|---|
| `coffees_path_tcr.sql` | `coffees` | 10 new Path coffees + 16 TCR coffees |
| `roastery_descriptors_path_tcr.sql` | `roastery_coffee_descriptors` | Bag note → SCA wheel mapping for all coffees |
| `archetype_assignments_path_tcr.sql` | `archetype_assignments` | Pre-cupping archetype estimates, confidence = medium |
| `roaster_blend_both.sql` | `roaster_blend` | 2 rows per coffee (12oz + 5lb), inventory_status = 'pending'; `coffee_id` backfilled automatically by schema.sql name-match |
| `dial_positions_path_tcr.sql` | `dial_archetype_positions` | Bloom Dial positions for 23 coffees (5 archetypes) |
| `coffee_alias_path_tcr.sql` | `coffee_alias` | Platform slot names → coffee mappings (25 rows) |
| `archetype_assignments_base.sql` *(#93)* | `archetype_assignments` | Bloom Dial base data — Kopi Safari → `earthy`, 4 previously-unplaced coffees → `chocolate_nutty` (low confidence) |
| `dial_positions_base.sql` *(#93)* | `dial_archetype_positions` | Bloom Dial base data — spread-for-connectivity moves (UPDATE, not INSERT — supersedes `dial_positions_path_tcr.sql`) |
| `dial_relationships_base.sql` *(#93)* | `dial_coffee_relationships` | Bloom Dial base data — full Dial Turn + Bridge Hop graph (46 rows) + 2 `category_hop` rows; retires the stale Crosshatch↔Feather In Cap bridge |
| `dial_seam_positions.sql` *(#93)* | `dial_archetype_positions` | Bloom Dial base data — 3 seam (guest) positions; depends on `is_guest` column from schema.sql |

**Path Coffee Roasters** (13 total; 3 from session 001 + 10 new):

| Coffee | Archetype | Dial Position | 12oz SKU | 5lb SKU |
|---|---|---|---|---|
| Colombia | balanced_sweet | Approachable | COL-12 | COL-5 |
| Feather In Cap | balanced_sweet | Default ★ | FIC-12 | FIC-5 |
| Crosshatch | balanced_sweet | Bold | CB-12 | CB-5 |
| Noam Blend | chocolate_nutty | Default ★ | NB-12 | NB-5 |
| Nocturnal Dark Roast | earthy | Default ★ | DR-12 | DR-5 |
| Vantablack Ultra-Dark | earthy | Bold | VB-12 | VB-5 |
| Honduras | floral | Default ★ | HON-12 | HON-5 |
| Ethiopia | fruity | Complex ★ | ETH-12 | ETH-5 |
| Sleepwalker Half-Caf | — | — | SW-12 | SW-5 |
| Decaf | — | — | DECAF-12 | DECAF-5 |
| Vanilla | — (Flavored) | — | VAN-12-G | VAN-5-G |
| Hazelnut | — (Flavored) | — | HAZ-12-G | HAZ-5-G |
| Chocolate | — (Flavored) | — | CHO-12-G | CHO-5-G |

**Temecula Coffee Roasters** (16 coffees, all new):

| Coffee | Archetype | Dial Position | 12oz SKU | 5lb SKU |
|---|---|---|---|---|
| Breakfast Blend | balanced_sweet | Approachable | BBLEND-12 | BBLEND-5 |
| Blonde Blend | balanced_sweet | Approachable | BLOND-12 | BLOND-5 |
| Guatemala | balanced_sweet | Default ★ | GUAT-12 | GUAT-5 |
| Colombia | balanced_sweet | Bold | COLO-12 | COLO-5 |
| Brazil Santos | chocolate_nutty | Default ★ | BRAZ-12 | BRAZ-5 |
| African Espresso Blend | chocolate_nutty | Bold | AFRICA-12 | AFRICA-5 |
| 6-Bean Espresso Blend | chocolate_nutty | Bold | 6BEAN-12 | 6BEAN-5 |
| Sumatra | earthy | Default ★ | SUM-12 | SUM-5 |
| Bali Blue | earthy | Bold | BALI-12 | BALI-5 |
| Uganda | earthy | Bold | UGAN-12 | UGAN-5 |
| Papua New Guinea | floral | Gentle | PNG-12 | PNG-5 |
| Ethiopia Natural | floral | Default ★ | ETHN-12 | ETHN-5 |
| Costa Rica | fruity | Gentle | COSTA-12 | COSTA-5 |
| Tanzania | fruity | Default ★ | TANZ-12 | TANZ-5 |
| Kenya | fruity | Complex | KENYA-12 | KENYA-5 |
| Kopi Safari | experimental | Default ★ | KOPI-12 | KOPI-5 |

★ = is_default on the Bloom Dial for that archetype + roaster

**Schema gap:** `coffees` has no UNIQUE constraint on `(name, roaster)`. Earlier xlsx import attempts created duplicate rows for some TCR coffees. All seed files above use `SELECT MIN(id) FROM coffees WHERE name = '...' AND roaster = '...'` to resolve FKs safely — always picks the first-inserted row even if duplicates exist. Roaster/archetype tables use UUID PKs so they are exempt (MIN not applicable, no duplicates).

**Data fix (2026-06-29):** `dial_archetype_positions` had a pre-existing row for Feather In Cap under `chocolate_nutty / sort_order=3 (Richer)` — a leftover from Session 001's old archetype tag. Deleted manually. Feather In Cap correctly sits in `balanced_sweet / sort_order=2 (Default)`.

---

## Cupping Tool Data Model

The cupping tool is built around a 9-table normalised schema. Here's how everything connects:

```
cupping_sessions
    └── cupping_session_coffees  (which coffees, in what order)
            ├── cupping_brew_params      (dose, ratio, grind, temp…)
            └── cupping_scores           (one row per taster; is_merged=true for combined)
                    ├── cupping_score_values      → coffee_dimensions   (numeric: sweetness 9–11, acidity 6–8…)
                    └── cupping_score_descriptors → cupping_note (flavor wheel: Blueberry, Dark Chocolate…)

coffees
    ├── archetype_assignments       (current + historical archetype tags per coffee)
    ├── roastery_coffee_descriptors → cupping_note  (roaster bag notes, structured)
    └── user_flavor_feedback        → cupping_note  (post-delivery customer feedback)

cupping_note  (SCA wheel reference — 84 descriptors, static)
coffee_dimensions    (12 cupping dimensions — numeric or free-text, static)

v_collaborative_flavor_wheel  (view — unions all three descriptor sources with 'internal' | 'roastery' | 'client' label)
```

**Design decisions:**
- `cupping_score_values` handles **numeric dimensions** (sweetness, acidity, bitterness, body…) with `value_min` / `value_max` on a 0–15 scale
- `cupping_score_descriptors` handles **flavor descriptors** as FK references to the SCA wheel instead of free text — structured and queryable; `intensity` (0–15) captures how prominent a descriptor was; `custom_notes` is the escape hatch for off-wheel descriptors
- **Three separate tables** for internal / roastery / client sources — each has a different shape (session context, static bag notes, user+order context). A single `source` column on `cupping_sessions` would force client feedback into a cupping session structure it doesn't fit
- **One row per descriptor** in both `roastery_coffee_descriptors` and `user_flavor_feedback` — not a TEXT[] array or comma-separated string. This makes it possible to COUNT mentions, AVG intensity, and filter by `wheel_category` across all three sources in the collaborative wheel view
- `cupping_note` is intentionally **not** further normalized (wheel_category / wheel_subcategory repeat as TEXT) — 84 rows of fixed reference data doesn't justify the JOIN complexity of a 3-table split

---

## SCA Flavor Wheel (`cupping_note`)

84 descriptors seeded from the SCA Coffee Taster's Flavor Wheel (source: Specialty Coffee Association / World Coffee Research Sensory Lexicon). Three-level hierarchy: `wheel_category` → `wheel_subcategory` → `descriptor`. Descriptors with no subcategory have `wheel_subcategory = NULL`.

**Seed file**: `backend/src/db/seeds/cupping_notes_sca_wheel.sql` — idempotent, skips if table already has rows.

| Category | Subcategories | Descriptors |
|---|---|---|
| Floral | Floral | Black Tea, Chamomile, Rose, Jasmine |
| Fruity | Berry, Dried Fruit, Other Fruit, Citrus Fruit | Blackberry, Raspberry, Blueberry, Strawberry, Raisin, Prune, Coconut, Cherry, Pomegranate, Pineapple, Grape, Apple, Peach, Pear, Grapefruit, Orange, Lemon, Lime |
| Sour / Fermented | Sour, Alcohol / Fermented | Sour Aromatics, Acetic Acid, Butyric Acid, Isovaleric Acid, Citric Acid, Malic Acid, Winey, Whiskey, Fermented, Overripe |
| Green / Vegetative | Raw | Olive Oil, Beany, Under-ripe, Peapod, Fresh, Dark Green, Vegetative, Hay-like, Herb-like |
| Other | Papery / Musty, Chemical | Stale, Cardboard, Papery, Woody, Moldy/Damp, Musty/Dusty, Musty/Earthy, Animalic, Meaty/Brothy, Phenolic, Bitter, Salty, Medicinal, Petroleum, Skunky, Rubber |
| Roasted | Burnt, Cereal | Pipe Tobacco, Tobacco, Acrid, Ashy, Smoky, Brown, Roast, Malt, Grain |
| Spices | Pungent, Brown Spice | Pepper, Anise, Nutmeg, Cinnamon, Clove |
| Nutty / Cocoa | Nutty, Cocoa | Peanuts, Hazelnut, Almond, Chocolate, Dark Chocolate |
| Sweet | Brown Sugar | Molasses, Maple Syrup, Caramelized, Honey, Vanilla, Vanillin, Overall Sweet, Sweet Aromatics |

**Check it:**
```sql
SELECT wheel_category, COUNT(*) FROM cupping_note GROUP BY wheel_category ORDER BY wheel_category;
```

---

## Cupping Sessions

Session data is stored in the cupping tool tables and inserted manually via Cloud SQL Studio. Seed files live in `backend/src/db/seeds/` (for reference only — do not add to `schema.sql`).

### Session 001 — Path Coffee Roasters, 2026-05-27
**File**: `backend/src/db/seeds/session_001_path_2026_05_27.sql`  
**Tasters**: Dana, Camila (first cupping — scores treated as directional)  
**Brew method**: Filter  
**Notes**: Scores merged into one result set (`taster_name = 'session_1_merged'`, `is_merged = true`)

| Coffee | Origin | Blend/Single | Process | Roast | Archetype | Confidence |
|---|---|---|---|---|---|---|
| Crosshatch | Nicaragua & Ethiopia | Blend | Washed | Light-medium | Balanced & Sweet | High |
| Ethiopia | Ethiopia | Single | Washed | Light-medium | Fruity | High |
| Feather In Cap | Colombia & Ethiopia | Blend | Washed | Medium-dark | Chocolate & Nutty | Medium |

**Score highlights:**
- **Crosshatch**: sweetness 9–11 (honey, sweet), acidity 6–8 (apple, banana, coconut — soft and round), bitterness 3–5
- **Ethiopia**: sweetness 6–8 (fruit-driven brightness), acidity 8–10 (pineapple — brightest of the three), bitterness 0–2 (trace only), tea-like body
- **Feather In Cap**: sweetness 7–9 (sweet on nose, tobacco took over in cup), acidity 2–4 (low), bitterness 5–7 (tobacco/burnt character — adjusted down), drying finish

**Roastery descriptors** (`roastery_coffee_descriptors`) — seeded from bag notes:  
File: `backend/src/db/seeds/roastery_descriptors_session_001.sql`

Roastery bag notes use subcategory-level language ("Dried Fruit", "Citrus") rather than SCA leaf descriptors. Each is mapped to the closest SCA leaf; the roaster's exact language is stored in the `notes` column.

| Coffee | Bag note | → SCA descriptor | Wheel category |
|---|---|---|---|
| Crosshatch | Caramel | Caramelized | Sweet / Brown Sugar |
| Crosshatch | Dried Fruit | Raisin | Fruity / Dried Fruit |
| Crosshatch | Citrus | Lemon | Fruity / Citrus Fruit |
| Ethiopia | Stone Fruit | Cherry | Fruity / Other Fruit |
| Ethiopia | Floral | Jasmine | Floral / Floral |
| Ethiopia | Citrus | Lemon | Fruity / Citrus Fruit |
| Feather In Cap | Brown Sugar | Caramelized | Sweet / Brown Sugar |
| Feather In Cap | Cocoa | Chocolate | Nutty / Cocoa |
| Feather In Cap | Dried Fruit | Prune | Fruity / Dried Fruit |

**Internal cupping descriptors** (`cupping_score_descriptors`) — seeded from merged session notes:  
File: `backend/src/db/seeds/internal_descriptors_session_001.sql`

| Coffee | Session note | → SCA descriptor | Wheel category |
|---|---|---|---|
| Crosshatch | dark chocolate | Dark Chocolate | Nutty / Cocoa |
| Crosshatch | cocoa | Chocolate | Nutty / Cocoa |
| Crosshatch | dried fruit | Raisin | Fruity / Dried Fruit |
| Crosshatch | citrus | Lemon | Fruity / Citrus Fruit |
| Crosshatch | honey / sweet | Honey | Sweet / Brown Sugar |
| Ethiopia | black tea | Black Tea | Floral |
| Ethiopia | floral | Jasmine | Floral / Floral |
| Ethiopia | berries | Blueberry | Fruity / Berry |
| Ethiopia | dried fruits | Raisin | Fruity / Dried Fruit |
| Ethiopia | citrus / lemon | Lemon | Fruity / Citrus Fruit |
| Feather In Cap | cocoa | Chocolate | Nutty / Cocoa |
| Feather In Cap | earthy | Musty / Earthy | Other / Papery / Musty |
| Feather In Cap | tobacco | Tobacco | Roasted |
| Feather In Cap | smoky | Smoky | Roasted / Burnt |
| Feather In Cap | burnt | Roast | Roasted / Burnt |
| Feather In Cap | spices | Pepper | Spices |

**Collaborative flavor wheel** — query all three sources together:
```sql
SELECT coffee_name, descriptor, wheel_category, source
FROM v_collaborative_flavor_wheel
ORDER BY coffee_name, source, descriptor;
```
Returns 25 rows for session 001: 16 internal (5+5+6) + 9 roastery (3+3+3).

---

## Useful DB Queries (run in Cloud SQL Studio)

### Check all tables
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

### User lifecycle stage distribution
```sql
SELECT cls.label, COUNT(*)
FROM user_lifecycle_state uls
JOIN user_lifecycle_stage cls ON cls.id = uls.stage_id
GROUP BY cls.label;
```

### Check enum values — single enum
```sql
SELECT unnest(enum_range(NULL::archetype_enum)) AS value;
```

### Check all enums at once
```sql
SELECT t.typname AS enum_name, e.enumlabel AS value, e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('archetype_enum', 'brew_method_enum', 'confidence_enum', 'address_type_enum', 'hop_direction_enum', 'hop_type_enum')
ORDER BY t.typname, e.enumsortorder;
```

### Check archetype rows
```sql
SELECT id, name, created_at FROM archetype ORDER BY name;
```

### Check dimensions
```sql
SELECT id, name, is_numeric, scale_min_label, scale_max_label, display_order
FROM coffee_dimensions ORDER BY display_order;
```

### Check cupping session data
```sql
SELECT cs.id, cs.session_date, cs.location, sc.display_order, c.name AS coffee
FROM cupping_sessions cs
JOIN cupping_session_coffees sc ON sc.session_id = cs.id
JOIN coffees c ON c.id = sc.coffee_id
ORDER BY cs.session_date, sc.display_order;
```

### Check archetype assignments (current only)
```sql
SELECT c.name AS coffee, aa.archetype, aa.confidence, aa.notes
FROM archetype_assignments aa
JOIN coffees c ON c.id = aa.coffee_id
WHERE aa.superseded_at IS NULL
ORDER BY c.name;
```

### Collaborative flavor wheel for a specific coffee
```sql
SELECT coffee_name, wheel_category, descriptor, source,
       COUNT(*)         AS mentions,
       AVG(intensity)   AS avg_intensity
FROM v_collaborative_flavor_wheel
WHERE coffee_id = 1   -- replace with target coffee id
GROUP BY coffee_name, wheel_category, descriptor, source
ORDER BY mentions DESC;
```

### Check quiz scoring matrix
```sql
SELECT * FROM v_quiz_scoring_matrix;

-- Filter to one quiz version
SELECT * FROM v_quiz_scoring_matrix WHERE quiz_version = 'v7';

-- Branch questions only
SELECT * FROM v_quiz_scoring_matrix WHERE quiz_type = 'branch';
```

### Archetype vectors — targets vs actual cupping scores
```sql
-- Targets only
SELECT * FROM v_archetype_vectors;

-- Targets vs actual cupping averages
SELECT * FROM v_archetype_dimension_comparison;
```

### Newsletter subscriber list
```sql
SELECT * FROM v_newsletter_subscribers;
```

### Check signup counts by source
```sql
SELECT source, COUNT(*) AS signups
FROM v_newsletter_subscribers
GROUP BY source
ORDER BY signups DESC;
```

### Admin user management
```sql
SELECT grant_admin('user@example.com');
SELECT revoke_admin('user@example.com');
SELECT * FROM list_admins();
```

### The Axis V2 — live stats aggregates (GET /api/axis/stats, WHAT_WE_BUILT.md #59)
No new tables/columns — reads existing archetype/dial/feedback tables. Useful for spot-checking the page's Tier-B counters directly:
```sql
-- Coffees currently mapped (has a live, non-superseded archetype assignment)
SELECT COUNT(DISTINCT coffee_id) FROM archetype_assignments WHERE superseded_at IS NULL;

-- Per-archetype counts (excludes the Experimental pseudo-archetype)
SELECT aa.archetype, COUNT(DISTINCT aa.coffee_id)
FROM archetype_assignments aa
JOIN dial_archetype_config dac ON dac.archetype = aa.archetype
WHERE aa.superseded_at IS NULL AND dac.is_archetype = true
GROUP BY aa.archetype;

-- Coffees flagged Experimental (category, not archetype)
SELECT COUNT(DISTINCT cca.coffee_id)
FROM coffee_category_assignment cca
JOIN coffee_category cc ON cc.id = cca.category_id
WHERE cc.code = 'experimental';
```

### Manual token grant

Function definition: `backend/src/db/functions/grant_tokens.sql` — not run automatically by `schema.sql`; deploy once via Cloud SQL Studio (paste + run), then it's re-usable. `CREATE OR REPLACE`, safe to re-run.

Mirrors `tokenService.ts`'s `grantTokens()`: upserts a `user_tokens` row if missing, adds to `balance` and `lifetime_earned`, and logs the grant to `token_events` (`reason` defaults to `'admin_grant'`).

```sql
SELECT grant_tokens('<firebase_uid>', 100);
SELECT grant_tokens('<firebase_uid>', 100, 'admin_grant', 'manual-2026-07-05');
```

Note: only updates Postgres (the source of truth). It does not write the Firestore `tokenBalance` mirror, but that mirror isn't read by the app anyway — see `user_tokens` note above.

### Check quiz scoring table directly
```sql
SELECT q.q_number, a.answer_text, ar.name AS archetype, aas.score
FROM quiz_answer_archetype_score aas
JOIN quiz_answer  a  ON a.id  = aas.answer_id
JOIN quiz_question q  ON q.id  = aas.question_id
JOIN archetype    ar ON ar.id = aas.archetype_id
ORDER BY q.q_number, ar.name;
```

### Check all questions and answers for a quiz version
```sql
SELECT qz.version, q.q_number, q.q_text,
       json_agg(json_build_object('text', a.answer_text, 'archetype', ar.name) ORDER BY a.id) AS answers
FROM quiz qz
JOIN quiz_question q ON q.quiz_id = qz.id
JOIN quiz_answer   a ON a.question_id = q.id
LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
WHERE qz.version = 'v7'
GROUP BY qz.version, q.q_number, q.q_text
ORDER BY q.q_number;
```

### Check Bloom Dial seed data
```sql
SELECT * FROM dial_archetype_config;
SELECT archetype, dimension_id, sort_order, label FROM dial_position_vocabulary ORDER BY archetype, sort_order;
```

### Bloom Dial — coffee positions on the dial
```sql
-- All positions across all archetypes
SELECT * FROM v_dial_positions;

-- One archetype only
SELECT * FROM v_dial_positions WHERE archetype = 'balanced_sweet';

-- Default coffee per archetype
SELECT archetype, coffee, dimension, dial_label FROM v_dial_positions WHERE is_default = true;
```

### Bloom Dial — navigation graph
```sql
-- Full hop graph
SELECT * FROM v_dial_navigation;

-- From a specific coffee
SELECT * FROM v_dial_navigation WHERE from_coffee = 'Crosshatch';

-- Bridge hops only (cross-archetype navigation)
SELECT * FROM v_dial_navigation WHERE hop_type = 'bridge_archetype';

-- Recommended hops only
SELECT * FROM v_dial_navigation WHERE is_recommended = true ORDER BY from_coffee, direction;
```

### Sommelier sessions

```sql
-- All sessions with intent and message count
SELECT ss.id, ss.uid, ss.intent, ss.turn_count, ss.is_closed, ss.close_reason, ss.last_active_at,
       COUNT(sm.id) AS message_count
FROM sommelier_sessions ss
LEFT JOIN sommelier_messages sm ON sm.session_id = ss.id
GROUP BY ss.id
ORDER BY ss.last_active_at DESC;

-- Messages for a specific session
SELECT role, content, model_used, created_at
FROM sommelier_messages
WHERE session_id = 1   -- replace with target session id
ORDER BY created_at ASC;

-- Token balance for a user
SELECT balance, lifetime_earned, lifetime_spent
FROM user_tokens
WHERE uid = 'firebase-uid-here';

-- Full token audit trail for a user
SELECT delta, reason, reference_id, created_at
FROM token_events
WHERE uid = 'firebase-uid-here'
ORDER BY created_at DESC;

-- Intent distribution across all sessions
SELECT intent, COUNT(*) AS sessions, AVG(turn_count) AS avg_turns
FROM sommelier_sessions
GROUP BY intent
ORDER BY sessions DESC;
```

### Firestore path reference (Sommelier)

| Path | Type | Notes |
|---|---|---|
| `config/sommelier` | Document | Admin-configurable weights, thresholds, intents, token economy, model routing |
| `config/sommelierCentroids` | Document | Intent centroid vectors — recomputed via admin button |
| `users/{uid}/metadata/confidence_profile` | Document | Behavioral confidence score + `hasPendingNegativeFeedback` flag. **4-segment path** — `metadata` is a sub-collection, `confidence_profile` is the document. |
| `users/{uid}/sommelier_evaluations/{id}` | Document | One doc per evaluation — intent label, 13-dim feature vector, outcome |
| `users/{uid}/metadata/taste_journey` | Document | Archetype history over time. **4-segment path** — fixed in Profile Part 1-3 (WHAT_WE_BUILT.md #100): the original `users/{uid}/taste_journey` (3 segments) is not a valid Firestore document reference (odd segment count), so every write/read via that path threw silently since Sommelier Task 1 — this doc never actually persisted until the fix. |
| `users/{uid}/feedback_events/{id}` | Document | One doc per feedback signal (SMS replies, future in-app ratings) |
| `users/{uid}/dial_events/{id}` | Document | Liam Dial Event Log (2026-07-18, WHAT_WE_BUILT.md #102) — only two *intentional* dial-movement kinds, `explicit_save`/`add_to_cart` (plain dial turns are never logged). Consumed by Liam's `recentDialActivity` opening-context summary (`EXPLORATION`/`PROFILE_AMBIGUOUS` only) and reserved for future analytics. |
