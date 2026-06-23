# Axis & Bloom — Database Reference

All database schema, table groups, views, enums, dimensions, session data, and useful queries. Read alongside `WHAT_WE_BUILT.md` (full project log) and `SOMMELIER_BUILT.md` (sommelier feature).

Schema file: `backend/src/db/schema.sql` — runs on every backend startup, fully idempotent.  
Migration scripts: `backend/src/db/migrations/`  
Seed files (run manually): `backend/src/db/seeds/`

---

## Database Schema (52 Tables)

The schema runs automatically on every backend startup (`CREATE TABLE IF NOT EXISTS` — fully idempotent, safe to run repeatedly).

It was merged from the original Supabase design plus adaptations for Firebase Auth (Firebase UID used as the user identifier instead of Supabase's auth.users). The cupping tool tables (added May 2026) are a separate group with SERIAL PKs rather than UUIDs.

### Table groups

**Lookup / reference**
- `user_type` — subscriber, admin, roaster partner, etc.
- `archetype` — named flavor profiles: Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy, Experimental
- `roaster` — drop-ship roastery partners
- `quiz` — quiz versions
- `cupping_note` — SCA Coffee Taster's Flavor Wheel: 84 descriptors across 9 categories and ~25 subcategories; `intensity_score` is NULL by default (assigned per cupping session, not at descriptor level)
- `lookup_value` — controlled vocabulary for admin dropdowns: `category` + `value` + `label` + `sort_order`; seeded with 20 values across 4 categories (`roast_level`, `process`, `blend_or_single`, `brew_method`); `ON CONFLICT DO UPDATE` so labels/order stay current on every deploy without duplicating rows

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
- `roaster_blend` — coffee blends available for purchase; links to Shopify variant IDs
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
- `order` — purchase records; links to Shopify order IDs
- `roastery_shipment_details` — tracking info per order
- `order_line_item` — individual blend quantities per order

**Intelligence**
- `notification_log` — email/SMS notifications sent
- `user_feedback_event` — ratings, repurchases, skips used to tune recommendations
- `user_recommendation_log` — AI recommendation audit trail

**Chat & newsletter**
- `chat_message` — Claude AI chat history per user
- `subscriber_source` — normalised reference table for signup origins; 4 seeded rows: `pre_launch` (Pre-Launch Popup), `newsletter` (Newsletter Modal), `post_quiz` (Post-Quiz Signup), `footer` (Footer Widget)
- `newsletter_subscriber` — `email` PK; `first_name TEXT`; `source_id` FK → `subscriber_source`; `user_id` FK → `user_profile` (optional); `subscribed BOOLEAN`; `created_at`

**Cupping tool** *(added May 2026 — SERIAL PKs, standalone from the main schema)*
- `coffees` — coffee catalogue (name, roaster, origin, process, roast level/shade, roaster flavor descriptors)
- `cupping_sessions` — session header (date, brew_method TEXT, location, notes); brew_method was originally `brew_method_enum` but migrated to `TEXT` so it accepts all lookup values (cupping, pour-over, etc.) without enum constraint failures
- `cupping_session_coffees` — junction: which coffees appeared in a session and in what order
- `coffee_dimensions` — cupping dimension catalogue, 12 seeded rows; `is_numeric = true` → scored 0–15 with scale labels; `is_numeric = false` → free-text notes only
- `cupping_scores` — per-taster score header (session_coffee_id, taster_name, is_merged, overall_notes); unique on `(session_coffee_id, taster_name)`; `is_merged = true` for the combined row
- `cupping_score_values` — one row per (cupping_score, dimension); `value_min` / `value_max` for numeric dims, `notes` for free-text dims; unique on `(cupping_score_id, dimension_id)`
- `cupping_score_descriptors` — structured flavor notes: links a score row to one or more SCA wheel descriptors (`cupping_note`) instead of free text; `intensity` (0–15) captures how prominent the descriptor was; `custom_notes` is an escape hatch for off-wheel descriptors; unique on `(cupping_score_id, cupping_note_id)`
- `roastery_coffee_descriptors` — structured version of `coffees.flavor_descriptors_roaster TEXT[]`; **one row per descriptor per coffee** (e.g. Crosshatch with 3 bag notes = 3 rows); links to SCA wheel via FK; unique on `(coffee_id, cupping_note_id)`
- `user_flavor_feedback` — post-delivery feedback from customers; **one row per descriptor per user per coffee** (e.g. a client who tasted Blueberry and Dark Chocolate = 2 rows); links user + coffee + order to SCA wheel descriptors; `intensity` optional; no session or brew params — lightweight by design
- `cupping_brew_params` — brew parameters per session-coffee (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device); all nullable
- `archetype_assignments` — archetype tag per coffee with confidence level; `superseded_at = NULL` for the current assignment, populated when a newer one replaces it
- `coffees.ai_summary TEXT` — AI-generated tasting note cached in the DB (added via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); generated once on first public page load, updated only via admin refresh; never regenerates on visitor traffic

**Bloom Dial** *(added June 2026)*
- `dial_archetype_config` — dominant dimension and Bloom Dial flag per archetype (seeded, 5 rows)
- `dial_position_vocabulary` — archetype+dimension-specific label vocabulary for the Bloom Dial (seeded, 20 rows)
- `dial_archetype_positions` — maps coffees to their position on the Bloom Dial per archetype
- `dial_coffee_relationships` — directional dimensional hop graph between coffees; used by the sommelier RAG and future computed dial positions

---

### Views

| View | Description |
|---|---|
| `v_collaborative_flavor_wheel` | All descriptor observations per coffee with source label (`internal`, `roastery`, `client`). Columns: `coffee_id`, `coffee_name`, `cupping_note_id`, `wheel_category`, `wheel_subcategory`, `descriptor`, `source`, `intensity`. No extra JOINs needed — names are already resolved. One row per observation; GROUP BY coffee + descriptor to aggregate. |
| `v_quiz_scoring_matrix` | Full scoring matrix — one row per (quiz_question, quiz_answer, optional archetype). Includes all questions across all quiz versions: main, branch, and Q6 (food signal, weight 0, no score rows). Columns: `quiz_version`, `quiz_type`, `q_number`, `q_text`, `a_number` (ROW_NUMBER), `answer_text`, `q_weight`, `ans_weight`, `resulting_archetype` (the archetype the answer maps to), `scored_archetype` (the archetype scored — NULL for Q6 and branch answers), `ans_score`. Lambda formula: `q_weight × ans_weight × ans_score`. Built from `quiz_answer` with LEFT JOINs to `quiz_answer_archetype_score` so zero-score answers still appear. Uses `DROP VIEW IF EXISTS` + `CREATE VIEW`. |
| `v_newsletter_subscribers` | All newsletter signups with human-readable source label. Columns: `email`, `first_name`, `source` (e.g. `Pre-Launch Popup`), `subscribed`, `signed_up_at`. Ordered newest first. |
| `v_archetype_vectors` | Archetype dimension targets — one row per archetype × dimension. Columns: `archetype`, `dimension`, `display_order`, `min_score`, `ideal_score`, `max_score`. Joins `archetype_vector` to `archetype` (FK) and `coffee_dimensions` (via `md5(name)::uuid`). |
| `v_archetype_dimension_comparison` | Target vs actual — same as `v_archetype_vectors` plus `avg_actual` (average of actual cupping scores for coffees assigned to that archetype) and `coffee_count`. Bridges `archetype_enum` → `archetype.name` via CASE. `avg_actual` is NULL for archetypes with no cupping data yet. |
| `v_dial_positions` | Current coffee positions on each archetype's Bloom Dial. Columns: `archetype`, `coffee`, `roaster`, `origin`, `dimension`, `position_sort`, `dial_label`, `has_bloom_dial`, `is_default`, `delta_from_default`, `is_computed`, `last_computed_at`. Joins `dial_archetype_positions` → `coffees`, `dial_position_vocabulary`, `coffee_dimensions`, `dial_archetype_config`. |
| `v_dial_navigation` | Directional hop graph between coffees. Columns: `from_coffee`, `to_coffee`, `dimension`, `direction` (`more`/`less`), `hop_type` (`within_archetype`/`bridge_archetype`), `delta`, `is_recommended`, `confidence`, `notes`. Joins `dial_coffee_relationships` → `coffees` (×2), `coffee_dimensions`. |

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
