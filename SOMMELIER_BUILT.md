# Sommelier — What We Built

A record of every decision, schema addition, and implementation detail for the Liam coffee sommelier feature. Read this file alongside `WHAT_WE_BUILT.md` when working on anything sommelier-related.

---

## Overview

Liam is the Axis & Bloom Coffee Sommelier — a subscription-gated, intent-driven AI chat experience. Every session is initialized with a classified **Intent** that shapes how Liam opens the conversation, which coffees are injected as context (RAG), and what conversation goal Liam is working toward.

The sommelier is also the foundation of a **customer intelligence layer**. Every session evaluation is logged with a feature vector, intent label, and outcome — the dataset that will eventually train a learned classifier to replace the current rule-based system.

---

## Architecture

```
User action / system event
        ↓
[Behavioral Confidence Score — computed from SQL, stored in Firestore]
        ↓
[Trigger Evaluator]
  Stage 1: Rule-based classification (reads config priority from Firestore)
  Stage 2: Haiku enrichment (generates opening context briefing)
  Stage 3: Writes evaluation to Firestore with feature vector + intent label
        ↓
[Session Initialization]
  - Token check (SQL — transactional)
  - RAG fetch (SQL — coffees by focus type, including coffee_relationships graph)
  - Insert sommelier_sessions row (stores catalogText, evaluationId, intent)
  - Generate opening message via chatWithSommelier()
        ↓
[Liam Chat — chatWithSommelier()]
  - System prompt: base Liam prompt + catalog + intent addendum + goal
  - Model: Haiku default → Sonnet when complexity keywords or message > N words
  - Token deducted per turn (SQL transaction)
  - Session closes after maxTurns (configurable)
        ↓
[Outcome Tracking — written back to Firestore evaluation document]
```

---

## Six Intents

Every sommelier session has exactly one intent, set at initialization and never changed.

| Intent | Triggered by | Goal |
|---|---|---|
| `PROFILE_AMBIGUOUS` | Quiz tie, low food signal alignment, ai_agent mode | Clarify archetype through dialogue |
| `RECOMMENDATION_MISS` | Negative feedback on AI-recommended coffee (last 60 days) | Understand what missed, find alternative |
| `TASTE_EVOLUTION` | Archetype changed on quiz retake | Explore what shifted, recalibrate |
| `DISCOVERY_SEEKER` | Experimental gate triggered in quiz | Push toward the unexpected |
| `CONVERSION` | Confirmed archetype + zero orders | Remove hesitation, first order |
| `EXPLORATION` | User-initiated, no stronger signal | Open-ended discovery |

All intent configuration (system prompt addendum, label, RAG focus, active toggle, max turns) lives in the Firestore `config/sommelier` document and is editable from the admin portal without a deploy.

---

## Two Confidence Variables

**`foodSignalAlignment`** (renamed from `confidence`): derived from the Q6 food instinct quiz question. Drives `recommendationMode`. Values: `high`, `medium`, `low`. Logic unchanged from original quiz scoring.

**`behavioralConfidence`**: new composite score (0.0–1.0) computed from:
- `quizStability` (weight 0.30): consistency of archetype across retakes
- `behavioralValidation` (weight 0.40): orders confirming the archetype
- `dataDepth` (weight 0.20): volume of total interactions (log scale)
- `feedbackAlignment` (weight 0.10): feedback consistent with archetype

Stored in Firestore `users/{uid}/metadata/confidence_profile`. Recomputed after quiz, orders, and feedback. Weights and thresholds admin-configurable in `config/sommelier`.

---

## Token Economy

Access is token-gated, not subscription-gated.

| Event | Delta |
|---|---|
| Account created | +20 tokens (signup bonus) |
| Order placed | +10 tokens (order bonus) |
| Each sommelier turn | -1 token |
| Token purchase | Placeholder — Stripe not yet wired |

Token balance stored in Cloud SQL (`user_tokens` table) with full audit trail (`token_events` table). Each turn deduction uses `SELECT FOR UPDATE` transaction to prevent race conditions. Balance synced to Firestore `users/{uid}.tokenBalance` after each transaction (fire-and-forget).

All token economy values are admin-configurable in `config/sommelier.tokenEconomy`.

---

## Model Routing

Default model: `claude-haiku-4-5-20251001`

Switches to `claude-sonnet-4-6` when:
- User's message contains a complexity keyword (configurable list in admin: compare, explain, why, confused, etc.)
- User's message is over N words (configurable in admin, default 100)

No turn-count-based switching. All routing values live in `config/sommelier.modelRouting`.

`max_tokens`: 200 (reduced from 400 on 2026-06-27 to enforce the 80-word response limit at the API level).

---

## RAG Design

The RAG is SQL-backed, not embedding-based. Before each session, `sommelierRag.ts` queries Cloud SQL for relevant coffees and formats them as a structured text block injected into Liam's system prompt.

**RAG focus types:**

| Focus | Used by | What it fetches |
|---|---|---|
| `archetype_range` | PROFILE_AMBIGUOUS | 2 coffees × 3 nearest archetypes |
| `alternatives` | RECOMMENDATION_MISS | Adjacent archetypes, excluding negatively-rated |
| `evolution_bridge` | TASTE_EVOLUTION | 3 from old archetype + 3 from new |
| `discovery` | DISCOVERY_SEEKER | Experimental coffees + graph traversal via `v_dial_navigation` (`bridge_archetype` + `is_recommended` hops) |
| `exact_match` | CONVERSION | User's primary archetype, best editorial content |
| `curated_mix` | EXPLORATION | 1 best-content coffee per archetype |

The formatted `catalogText` is stored in `sommelier_sessions.context_data.catalogText` at session start — not re-queried on every turn.

**Bloom Dial graph (`dial_coffee_relationships` + `v_dial_navigation` view):**
Used by `discovery` and `alternatives` RAG focus types for dimensional hop traversal. See Bloom Dial section below.

---

## Bloom Dial and Coffee Relationships

### `dial_coffee_relationships` table

Directional navigation graph between coffees. Each row represents a hop: "from this coffee, go here if you want more/less of a specific dimension."

```
id               SERIAL PRIMARY KEY
from_coffee_id   INT REFERENCES coffees(id) ON DELETE CASCADE
to_coffee_id     INT REFERENCES coffees(id) ON DELETE CASCADE
dimension_id     INT REFERENCES coffee_dimensions(id) NOT NULL
direction        hop_direction_enum NOT NULL   -- 'more' | 'less'
delta            NUMERIC
hop_type         hop_type_enum NOT NULL        -- 'within_archetype' | 'bridge_archetype'
is_recommended   BOOLEAN DEFAULT FALSE
confidence       confidence_enum DEFAULT 'medium'
notes            TEXT
created_at       TIMESTAMPTZ DEFAULT NOW()
UNIQUE(from_coffee_id, to_coffee_id, dimension_id, direction)
```

### `dial_archetype_positions` table

Maps coffees to their named position on the Bloom Dial per archetype. Position label and description come from `dial_position_vocabulary`.

```
id                  SERIAL PRIMARY KEY
archetype           archetype_enum NOT NULL
coffee_id           INT REFERENCES coffees(id) ON DELETE CASCADE
vocabulary_id       INT REFERENCES dial_position_vocabulary(id) NOT NULL
is_default          BOOLEAN DEFAULT FALSE
delta_from_default  NUMERIC
is_computed         BOOLEAN DEFAULT FALSE
last_computed_at    TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT NOW()
UNIQUE(archetype, coffee_id)
```

### How the Bloom Dial works

1. User lands on their archetype's default coffee (`is_default = true` in `dial_archetype_positions`)
2. User clicks "More Intense" → query `v_dial_navigation WHERE from_coffee = X AND hop_label = 'More Intense' AND hop_type = 'within_archetype'`
3. Returns the next coffee in that direction
4. Can chain multiple hops (Classic → Intense → Very Intense)

Label vocabulary comes from `dial_position_vocabulary` (archetype+dimension-specific). Config flags in `dial_archetype_config` control which archetypes have the Bloom Dial enabled.

### How it improves Liam

- `DISCOVERY_SEEKER` RAG queries `v_dial_navigation` outward from the user's current coffee via `bridge_archetype` hops, not just archetype labels
- `RECOMMENDATION_MISS` queries `v_dial_navigation` directionally: if feedback suggests "too strong," traverse `direction = 'less'` on the relevant dimension

**As of the Bloom Dial admin reorg (`WHAT_WE_BUILT.md` #75, 2026-07-09):** `dial_coffee_relationships` is no longer Liam-only. `bridge_archetype` hops now also feed `v_archetype_adjacency` (cross-archetype adjacency summary, `GET /api/admin/dial/archetype-adjacency`), and `within_archetype` hops are cross-checked against a new cupping-based dial-position suggestion (`dialSuggestion.ts`, `getDialSuggestion()`) — a disagreement surfaces as `hop_conflict` on the Coffees admin page. None of this changes what Liam sees or how the RAG focus types above work; it's a second, admin-facing consumer of the same table. `dial_archetype_config` also gained `is_archetype BOOLEAN` (`false` for `experimental`, `true` for the other 5) — doesn't affect Liam's RAG queries, which don't filter on it.

**As of coffee categories (`WHAT_WE_BUILT.md` #78, 2026-07-10):** `dial_coffee_relationships` gained nullable `from_category_id`/`to_category_id` and a new `hop_type_enum` value `category_hop`, for hops where one or both endpoints is a `coffee_category` (e.g. "Experimental") rather than a specific coffee. Confirmed no impact on Liam — `sommelierRag.ts`'s `v_dial_navigation` queries above already `INNER JOIN` on `coffees` for both endpoints, so any `category_hop` row (with a NULL `from_coffee_id`/`to_coffee_id`) is automatically excluded from the view, the same way it's already excluded from `v_archetype_adjacency`. No query changes were needed here. Category-hop creation is SQL-only for now — there's no admin UI/API path that could even populate these rows yet.

---

## Firestore Collections (new)

| Path | Content |
|---|---|
| `config/sommelier` | All admin-configurable values: weights, thresholds, intents, token economy, model routing, RAG limits, time windows, rule priority |
| `config/sommelierCentroids` | Intent centroid vectors (13-dim average of feature vectors per intent). Recomputed on demand via admin button. |
| `users/{uid}/metadata/confidence_profile` | Behavioral confidence score, components, raw inputs. Also stores `hasPendingNegativeFeedback` flag (set by SMS feedback parser, read by evaluator for RECOMMENDATION_MISS). **Path note**: 4 segments required — `metadata` is a subcollection, `confidence_profile` is the document. |
| `users/{uid}/sommelier_evaluations/{id}` | One document per evaluation — intent label (ML label), feature vector (13-dim), user state snapshot, triggers fired, outcome (written back when known) |
| `users/{uid}/sommelier_sessions/{sessionId}/messages/{auto-id}` | Conversation messages — `role` (`user`\|`assistant`), `content`, `modelUsed`, `seq` (0-based integer for ordering), `createdAt` (server timestamp). `sessionId` matches the `sommelier_sessions.id` integer from PostgreSQL. Written here instead of the `sommelier_messages` SQL table as of 2026-06-27. `seq` formula: 0 = opening, `turn_count * 2 - 1` = user messages, `turn_count * 2` = assistant replies. |
| `users/{uid}/metadata/taste_journey` | Archetype history over time — evolution count, current streak, history array. **Path note**: 4 segments required, same as `confidence_profile` above — fixed in WHAT_WE_BUILT.md #100 (Profile Parts 1-3). The original `users/{uid}/taste_journey` (3 segments) is not a valid Firestore document reference (odd segment count throws), so this doc never actually persisted from S9 until the fix — see S49. |
| `users/{uid}/feedback_events/{id}` | One document per feedback signal from Liam (SMS replies, future in-app ratings). Fields: `signalType`, `rating`, `sValue`, `confidence`, `source`, `sentiment`, `rawText`, `descriptors`, `orderId`, `blendId`, `liamSmsFeedbackId`, `createdAt`. Read by `behavioralConfidence.ts` for `feedbackAlignment` component. |

---

## SQL Tables (new)

| Table | Purpose |
|---|---|
| `sommelier_sessions` | One row per sommelier session — intent, turn count, close reason, context_data JSONB |
| `sommelier_messages` | **Legacy** — one row per turn (role, content, model_used, session FK). Messages now written to Firestore `users/{uid}/sommelier_sessions/{sessionId}/messages` as of 2026-06-27. Table kept for backwards compatibility; `GET /:sessionId/messages` falls back to it for sessions created before the migration. |
| `user_tokens` | Token balance per user — balance, lifetime earned/spent |
| `token_events` | Audit trail — every earn and spend with reason and reference ID |
| `dial_archetype_config` | Dominant dimension and Bloom Dial flag per archetype (seeded, 6 rows incl. `experimental`). Gained `is_archetype BOOLEAN` (#75) — `false` for `experimental` only. |
| `dial_position_vocabulary` | Archetype+dimension-specific label vocabulary for the Bloom Dial (seeded, 24 rows incl. `experimental`) |
| `dial_archetype_positions` | Bloom Dial positions — maps coffees to a vocabulary position per archetype |
| `dial_coffee_relationships` | Navigation graph — directional hops between coffees along dimensions |

---

## API Endpoints (new)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/sommelier/evaluate` | Required | Run trigger evaluation — no token cost |
| POST | `/api/sommelier/start` | Required | Start session — token check, RAG fetch, opening message |
| POST | `/api/sommelier/:id/message` | Required | Send a turn — token deducted per turn |
| GET | `/api/sommelier/sessions` | Required | Last 5 sessions for this user |
| GET | `/api/sommelier/:id/messages` | Required | Full message history for a session. Reads from Firestore; falls back to SQL for pre-migration sessions. Returns `{ messages: [{role, content}], coffeeNames: [] }`. |
| POST | `/api/sommelier/:id/close` | Required | User-initiated session close |
| GET | `/api/tokens/balance` | Required | Current token balance |
| POST | `/api/tokens/purchase` | Required | Stripe placeholder — returns 503 |
| GET | `/api/admin/sommelier/stats` | Admin | Evaluation aggregates + token stats |
| PATCH | `/api/admin/sommelier/config` | Admin | Update Firestore config document |
| POST | `/api/admin/sommelier/recompute-centroids` | Admin | Recompute intent centroid vectors |
| POST | `/api/admin/sommelier/dial` | Admin | Bloom Dial write operations (positions + hops) |

---

## Admin Portal (new pages)

| Route | Page | Purpose |
|---|---|---|
| `/admin/sommelier/config` | AdminSommelierConfig | Edit weights, thresholds, token economy, model routing, session limits, rule priority |
| `/admin/sommelier/intents` | AdminIntentEditor | Edit per-intent: addendum, label, RAG focus, max turns, active toggle |
| `/admin/sommelier/flow` | AdminSommelierFlow | Visual flow diagram with live stats and config overlay |
| `/admin/sommelier/dial` | AdminBloomDial | Manage dial positions (`dial_archetype_positions`) and hop graph (`dial_coffee_relationships`) |

---

## Frontend Components (new)

| Component | Route | Description |
|---|---|---|
| `Sommelier.tsx` | `/sommelier` | Full-screen Claude/ChatGPT-style layout (2026-06-28). `fixed inset-0`, no nav/footer (suppressed in `PublicLayout`). **Sidebar** (224px, `bg-stone-50`): "Axis & Bloom" label, "Liam" in bold, "Sommelier Concierge" role label, "+ New conversation" button, past sessions list (intent label + date + ended flag), token balance pinned at bottom. Mobile: sidebar hidden, hamburger opens animated drawer with backdrop. **Main column**: top bar (intent label, turn counter `X/N`, × close), scrollable body (`max-w-2xl mx-auto`), input bar pinned at bottom. **Message thread**: same prose style — `LIAM` / `YOU` name labels above paragraphs, `space-y-10`, no backgrounds/borders. Coffee names shown as a subtle dotted `·` line above the first message (not a pill header). **Input bar**: `rounded-2xl`, integrated send button (up-arrow), status row (turns remaining · token count) below the textarea. All phases: `loading` → `resume_prompt` → `chat` → `error`. |

Entry points added to existing components:
- `FlavorQuiz.tsx` — tie interstitial with "Talk to Liam" CTA
- `Profile.tsx` — "Chat with Liam" link with token balance display
- `CoffeesPage.tsx` — "Ask Liam" button

---

## ML Data Layer

Every `sommelier_evaluations` document stores:
- `featureVector: number[]` — 13-dimensional numerical representation of user state
- `featureSchema: string[]` — ordered list of feature names (self-describing)
- `intent: string` — the ML label (the classification assigned)
- `userStateSnapshot` — full state at decision time, never updated after creation
- `outcome` — written back when behavior is observed

The centroid of each intent's feature vectors is stored in `config/sommelierCentroids` and recomputed on demand. This is the bridge from rule-based to learned classification.

---

## Services (new files)

| File | Purpose |
|---|---|
| `backend/src/services/sommelierConfig.ts` | Firestore onSnapshot live config listener |
| `backend/src/services/behavioralConfidence.ts` | Computes composite confidence score from SQL |
| `backend/src/services/sommelierEvaluator.ts` | 3-stage evaluation: rules + Haiku + Firestore write |
| `backend/src/services/sommelierRag.ts` | Fetches coffees by RAG focus, formats catalog text |
| `backend/src/services/tokenService.ts` | Transactional token spend/grant |
| `backend/src/services/outcomeTracker.ts` | Writes outcome fields back to Firestore evaluations |
| `backend/src/services/smsProvider.ts` | SMS send interface — placeholder until provider (Twilio) is wired |
| `backend/src/services/liamSmsFeedback.ts` | Schedules, sends, and parses SMS feedback — writes to Firestore `feedback_events` |

---

## Issues and Decisions

### Task 1 — Foundation (2026-06-23)

#### S1. Renamed `confidence` → `foodSignalAlignment` in quiz API responses
**Decision**: `POST /api/quiz/score` and `POST /api/quiz/results` now return `foodSignalAlignment` instead of `confidence`. The underlying computation in `quizScoring.ts` still uses `confidence` internally — only the JSON field name changed. `claude.ts` `getRecommendation` context param was kept as `confidence` (internal API); quiz.ts passes `foodSignalAlignment ?? 'high'` to it as `confidence`. Firestore quiz session and quiz context_data JSONB both updated to use `foodSignalAlignment`. `ScoreResult` interface in `FlavorQuiz.tsx` updated.

#### S2. Tie detection added to quiz score response
**Decision**: `POST /api/quiz/score` now includes `tieDetected: boolean` and `tiedArchetypes: string[]`. A tie is detected when: (1) multiple archetypes share the highest raw score AND (2) none of the cascade questions (Q5→Q4→Q2→Q1) resolve it. The technical fallback winner is still `Balanced & Sweet`. When the cascade does resolve a score tie, `tieDetected = false`. This field drives the `PROFILE_AMBIGUOUS` intent in the sommelier evaluator.

#### S3. Four new SQL tables in schema.sql (all idempotent)
- `user_tokens` (uid TEXT PK → firebase_uid) — token balance per user
- `token_events` (SERIAL PK) — full audit trail of every earn and spend
- `sommelier_sessions` (SERIAL PK) — one row per Liam session
- `sommelier_messages` (SERIAL PK) — one row per turn in a session
Token tables placed after `user_payment_detail`. Sommelier tables placed after `chat_message`.

#### S4. Token initialization wired into `POST /api/auth/sync`
**Decision**: `ON CONFLICT (uid) DO NOTHING` makes this idempotent — existing users with a token row are not affected. The `token_events` row is only inserted if `rowCount === 1` (new insert, not conflict). Signup bonus amount reads from `getSommelierConfig()?.tokenEconomy?.signupBonus` with `?? 20` fallback for startup race conditions.

#### S5. Order bonus wired into `POST /api/orders`
**Decision**: Award runs in a fire-and-forget async block after `res.json()`. Uses SQL `BEGIN/COMMIT` transaction. Order bonus amount reads from config with `?? 10` fallback. After transaction, syncs new balance to Firestore `users/{uid}.tokenBalance` (non-blocking). Rollback on error.

#### S6. Firestore config auto-seeded on startup
**Decision**: `backend/src/db/seeds/sommelier_config_seed.ts` exports `seedSommelierConfig()` and `seedSommelierCentroids()`. Both are no-ops if the document already exists. Called from `initSommelierConfig()` before the live listener subscribes. `config/sommelierCentroids` initialized with empty 13-dim zero centroids for all 6 intents so downstream code can always read a valid array.

#### S7. `sommelierConfig.ts` — live Firestore listener
**Decision**: `initSommelierConfig()` seeds → loads once synchronously (so config is available before first request) → subscribes to `onSnapshot` for live updates. `getSommelierConfig()` returns the in-memory copy (null before init, which all callers handle with `?? fallback`). Log line on every update lists changed top-level keys.

#### S8. `behavioralConfidence.ts` — composite confidence score
**Decision**: SQL queries use the proper `"order"` table (quoted, reserved word). Firestore feedback_events subcollection may not exist yet — query wrapped in try/catch, treats zero docs as zero events (→ feedbackAlignment 0.50 neutral). Writes to `users/{uid}/metadata/confidence_profile` with `set(..., { merge: true })` and `hasPendingNegativeFeedback` flag. Called as fire-and-forget from quiz results route after quiz session is saved (so the new quiz counts in the computation).

#### S9. `taste_journey` Firestore writes after quiz completion
**Decision**: Reads the current journey doc, checks if archetype changed, builds the full updated array client-side (FieldValue.arrayUnion() can't be used because serverTimestamp() isn't valid inside array items). Uses `Timestamp.now()` from `firebase-admin/firestore` for array item dates. Always fires after `computeBehavioralConfidence()` so `confidenceLevel` is fresh. Fire-and-forget within a try/catch that logs errors.

#### S10. `POST /api/admin/sommelier/recompute-centroids` endpoint
**Decision**: Uses Firestore `collectionGroup('sommelier_evaluations')` to read all evaluations across all users. Filters to documents with a valid 13-dimensional `featureVector`. Writes averaged centroids to `config/sommelierCentroids`. Returns `intentCounts` map in the response for the admin to see sample sizes.

#### S11. Sommelier router stub
**Decision**: Created `backend/src/routes/sommelier.ts` as an empty router so `index.ts` compiles and deploys cleanly. Task 2 will add all 5 session/token endpoints to this file.

#### S12. Firestore security rules for `config/*`
**Note**: No `.rules` file found in the repo — rules are managed via Firebase console. The rule to add is:
```
match /config/{doc} {
  allow read: if request.auth != null && request.auth.token.admin == true;
  allow write: if false;
}
```
Apply this in Firebase Console → Firestore → Rules before shipping Liam to production.

---

### Task 5 — SMS Feedback Loop (2026-06-26)

#### S13. Order hook — old `orders` table, not normalized `"order"` table
**Decision**: `backend/src/routes/orders.ts` inserts into the old `orders` table (columns: `uid TEXT`, `shopify_order_id`, `status`, `items JSONB`, `shipping_address`, `total_cents`). The normalized `"order"` table in schema.sql is not yet used by the order route. As a result, `sommelier_sms_feedback.order_id` (which FKs to `"order"(id)`) is always passed as `null` until the orders route is migrated. The `blend_id` is extracted from `items[0].blendId ?? items[0].id ?? null` — either field name may appear depending on what the frontend sends. Fire-and-forget after `res.json()`, consistent with token bonus pattern.

**Resolved in `WHAT_WE_BUILT.md` #73 (2026-07-07)** — `orders.ts` now writes to `"order"` + `order_line_item`; `sommelier_sms_feedback.order_id` is passed the real order ID, not `null`. This also fixed `totalOrders` in `evaluateSommelier()`, which had silently read 0 for every real customer since nothing wrote to `"order"` — see S36.

#### S14. `schedulePostDeliveryMessage` takes firebase UID, not user_profile UUID
**Decision**: The spec signature was `schedulePostDeliveryMessage(userId, orderId, blendId)` where `userId` = `user_profile.id`. But `orders.ts` only has `req.uid` (firebase UID). The function was changed to accept `(firebaseUid: string, blendId: string | null)` and does the `user_profile` lookup internally. Idempotency is keyed on `(user_id, blend_id)` — one outbound message per blend per user.

**Extended in `WHAT_WE_BUILT.md` #73 (2026-07-07)** — signature gained a third param: `schedulePostDeliveryMessage(firebaseUid, blendId, orderId = null)`. The `user_profile` lookup and `(user_id, blend_id)` idempotency key are unchanged.

#### S15. Message body length check
**Decision**: Primary message: `Hey [name]! It's Liam from Axis & Bloom — how are you finding the [Coffee Name]? Any thoughts welcome 🌸`. Checked against 160 chars at runtime. Falls back to shorter variant without emoji: `Hey [name], it's Liam from Axis & Bloom! How's the [Coffee Name] treating you? Any thoughts?` Long coffee names could still push either over 160 — acceptable edge case for now since SMS concatenation is handled by providers transparently.

#### S16. Haiku parse failures default gracefully
**Decision**: Any exception from Anthropic (network, rate limit) or JSON parse failure defaults to `{ sentiment: 'neutral', rating: 3, descriptors: [] }` and logs `[liamSms] Haiku parse failed for inbound {id}`. Firestore write and SQL update still proceed with the neutral defaults — a failed parse does not leave the inbound row in a stuck state.

#### S17. CRON_SECRET — shared secret for cron endpoint auth
**Decision**: `GET /api/cron/liam-sms-send` checks `x-cron-secret` header against `process.env.CRON_SECRET` (loaded from GCP Secret Manager via Cloud Run). Returns 401 if missing or wrong. Cloud Scheduler must be configured with this header. The secret must be created manually in GCP Secret Manager and added to `deploy.yml` `--set-secrets`. See README for Cloud Scheduler setup steps.

**Incident, 2026-08-15 (`WHAT_WE_BUILT.md` #166)** — the value this decision assumed would be a plain shared string had in fact carried a leading UTF-8 BOM since it was first created, breaking `requireCronSecret`'s exact-string compare for every cron job that has ever consumed it (by this point `liam-sms-send`, `brew-card-arrival-send`, `beat-dial-in-send`, `coffee-content-backfill`, `expire-company-gift-codes`, `sponsored-subscription-check`, `purge-stale-anonymous-guests`, `purge-api-events` — all share the one env var). Rotated to a clean machine-generated value; `backend/src/index.ts` now warns at boot (`[cron/secret-config]`) if `CRON_SECRET` is unset or `!== .trim()`, which also catches a stray BOM. This S17 decision's comparison mechanism itself is unchanged — only the secret's own hygiene and a boot-time check were added.

#### S18. Webhook always returns 200
**Decision**: `POST /api/webhooks/sms/inbound` returns HTTP 200 in all cases — unknown number, DB error, everything. SMS providers (Twilio) retry on non-200 responses, which would cause duplicate processing. Errors are logged but do not surface to the provider.

#### S19. New SQL table: `sommelier_sms_feedback`
One row per SMS message (both outbound and inbound). Outbound rows track scheduling and delivery. Inbound rows store the reply, parsed sentiment, rating, descriptors, and the Firestore doc ID written to `users/{uid}/feedback_events`. Idempotency: one outbound per `(user_id, blend_id)`. `reply_to_id` links inbound back to outbound. `firestore_feedback_doc_id` links SQL back to Firestore.

#### S20. New Firestore subcollection: `users/{uid}/feedback_events`
Follows the same pattern as `users/{uid}/quiz_sessions` — a subcollection under the user doc. One document per feedback signal. `liamSmsFeedbackId` links back to SQL. `sValue` is the normalized 0.0–1.0 signal value used by `behavioralConfidence.ts` `feedbackAlignment` component. Read by `sommelierEvaluator.ts` when classifying intent.

---

### Session Debugging — evaluate:500 and start:500 (2026-06-28)

#### S21. "Talk to Liam" entry points broken — three bugs
Three separate issues prevented any entry point from reaching the sommelier:

1. **FlavorQuiz wrong href**: quiz result screen "Talk to our coffee sommelier" had `href: '/'` (home page). Fixed to `href: '/sommelier?entry=user_initiated'`.
2. **RequireAuth dropped query params**: `/sommelier` route had `<RequireAuth redirectTo="/sign-in?redirect=/sommelier">`. This lost `?entry=` and `?tied=` query params on sign-in redirect. Fixed by removing `redirectTo` so `RequireAuth` auto-builds the full URL from `location.pathname + location.search`.
3. **Sommelier.tsx wrong layout**: Component rendered chat bubbles. Rebuilt as prose thread: `LIAM` / `YOU` labels above paragraphs, full-width, no backgrounds/borders, `space-y-10` spacing.

#### S22. evaluate:500 — invalid Firestore document path (root cause)
**Confirmed via Cloud Run logs:** `Error: Value for argument "documentPath" must point to a document, but was "users/{uid}/confidence_profile". Your path does not contain an even number of components.`

`firestoreDb.doc("users/{uid}/confidence_profile")` has 3 path segments. Firestore `.doc()` requires even segments (collection/document alternating). The exception is **synchronous** — thrown before any `.catch()` runs — so it escapes `computeBehavioralConfidence()` into the evaluate route's outer try/catch → 500 on every call.

**Fix:** Changed to `users/${uid}/metadata/confidence_profile` (4 segments) in all three files:
- `behavioralConfidence.ts` — write (also wrapped `.doc()` in try/catch as guard)
- `sommelierEvaluator.ts` — read
- `liamSmsFeedback.ts` — write

#### S23. evaluate:500 — wrong SQL table name in `sommelierEvaluator.ts`
`evaluateSommelier()` queried `SELECT COUNT(*) FROM orders WHERE uid = $1`. The table is `"order"` (double-quoted reserved keyword), not `orders`. Also no `uid` column — join goes through `user_profile`. Fixed to:
```sql
SELECT COUNT(DISTINCT o.id) AS order_count
FROM "order" o
JOIN user_profile up ON up.id = o.user_id
WHERE up.firebase_uid = $1
```

#### S24. All SQL queries in evaluate pipeline wrapped in try/catch
Both `computeBehavioralConfidence()` and `evaluateSommelier()` had bare `await db.query()` calls that could throw and crash the evaluate endpoint. All SQL queries now have individual try/catch wrappers that log the error and default to 0 counts, so a table or column issue never produces a 500.

#### S25. start:500 — ambiguous SQL operator in `spendToken` (fixed 2026-06-28)
**Error:** `operator is not unique: - unknown` (PostgreSQL error `42725`) inside `spendToken` at `tokenService.ts:36`.

**Cause:** The INSERT into `token_events` used `SELECT $1, -$2, $3, $4, balance FROM user_tokens WHERE uid = $1`. PostgreSQL has no type context for `$2` in a bare SELECT list — the unary `-` operator is ambiguous between `-integer`, `-numeric`, `-float8`, etc.

**Fix:** Pass the negative value directly from JavaScript — `[uid, -costPerTurn, reason, referenceId]` — so the SQL becomes `SELECT $1, $2, ...`. PostgreSQL can now infer the type from the value itself.

#### S26. Firestore composite index missing for `checkReturnedToSommelier` (outstanding)
**Not a 500 blocker** — the error is caught inside `checkReturnedToSommelier`'s own try/catch and logged. But the `returnedToSommelier` outcome field is never written.

**Query:** `.where('sessionStarted', '==', true).orderBy('startedAt', 'desc')` on `users/{uid}/sommelier_evaluations`. Firestore requires a composite index when `where` and `orderBy` target different fields.

**Fix needed:** Create composite index in Firebase Console:
- Collection: `sommelier_evaluations`
- Fields: `sessionStarted ASC`, `startedAt DESC`

The auto-create link is embedded in the Cloud Run error log under `[outcomeTracker] checkReturnedToSommelier error`.

#### S27. Session resume showed empty chat (fixed 2026-06-27)
When a user returned to `/sommelier` and clicked "Resume conversation", the frontend set the session ID but never fetched prior messages — the chat opened blank.

**Fix (two parts):**
1. New `GET /api/sommelier/:sessionId/messages` endpoint returns full message history + coffee names. Reads from Firestore; falls back to SQL for sessions predating the migration.
2. `Sommelier.tsx` `handleResumeResume()` now fetches from this endpoint, sets `messages` to the returned history (falling back to a synthetic "Welcome back" only if empty), and restores the coffee strip — before entering chat phase.

#### S36. Stage 1 data collection extracted to shared `userSignals.ts` (2026-07-07)
**Context**: `WHAT_WE_BUILT.md` #73 built a Cloud SQL user-lifecycle status system alongside a new requirement: don't duplicate the Sommelier's data-collection queries. `getUserSignals(uid)` in `backend/src/services/userSignals.ts` now owns everything `evaluateSommelier()`'s old Stage 1 used to inline directly — quiz history, order history (now correctly reading from `"order"`, see S13), demographics, and the Firestore `confidence_profile` read.

**What changed in `sommelierEvaluator.ts`**: the entire Stage 1 block (quiz sessions, order count, demographic query, negative-feedback lookback — all previously inline SQL/Firestore calls) replaced with one call: `const signals = await getUserSignals(uid)`, destructured into the same local variable names the rest of the function already used. **The six-Intent rule logic itself is unchanged** — same triggers, same priority order, same feature vector shape. `TASTE_EVOLUTION`'s check simplified from comparing `latestQuiz`/`prevQuiz` archetype names directly to reading `signals.archetypeChangedLastTwoQuizzes` (a boolean `getUserSignals()` now computes once).

**Why this matters for future Sommelier work**: `sommelierEvaluator.ts` no longer contains its own SQL. Any future query changes to quiz/order/demographic data collection happen in `userSignals.ts` and are automatically picked up by both the Sommelier and the lifecycle system — the two are independent consumers of one shared collector, never reading each other's output (see `WHAT_WE_BUILT.md` #73 for the full architecture split).

**Verified**: `CONVERSION` (confirmed archetype + zero orders) and the feature vector's `normalizedOrderCount` dimension now reflect real order counts post-S13-fix instead of always computing against 0.

#### S37. New public hop-navigation endpoint reads the same `dial_coffee_relationships` graph Liam's RAG uses (2026-07-11)
**Context**: not a Sommelier change — flagged here for continuity since it touches shared data. `WHAT_WE_BUILT.md` #80 (The Bloom Part 1 backend) added `GET /api/coffees/:coffeeId/hops`, a public, roaster-blind read over `dial_coffee_relationships` (`is_recommended = true` only, live-derives the target's current slot, drops inactive targets, capped at 3, confidence-ordered) for the new customer-facing Bloom page. This is a separate, additive read path — it does not modify `dial_coffee_relationships`, does not touch `sommelierRag.ts`'s own queries against the same table, and Liam's hop-graph RAG context is unaffected.

#### S38. Task 6 Step 2b — catalog context was leaking the roaster name into every Liam session; content-generation prompts were leaking the raw coffee name onto The Bloom (2026-07-11)
**Context**: `SOMMELIER_TASK_6_VOICE.md` was updated (Step 2 marked already-complete from the original 2026-07-04 pass — see S35/#62 — and a new Step 2b added) specifically to chase down a leak found while building The Bloom (Part 2, `WHAT_WE_BUILT.md` #81): the AI-generated "Liam's intake" text on a Bloom card literally named the coffee ("Brazil Santos is a comforting cup..."). Auditing per Step 2b surfaced **two distinct, real leaks**, both fixed:

**1. `sommelierRag.ts`'s `buildCatalogText()` — roaster name injected directly into Liam's system prompt, every session.** `c.roaster` was selected in `BASE_COFFEE_SQL` and all five duplicated ad-hoc RAG queries (`archetype_range`/`alternatives`/`evolution_bridge`/`discovery`/`exact_match`/`curated_mix` branches of `fetchSommelierCoffees()`), then printed straight into the catalog line (`${c.name} — ${c.roaster} — ${archetypeLabel}`). This meant Liam's actual system prompt context — not just the base prompt's "never reveal" instruction — contained the raw roastery name and the coffee's raw internal name for every coffee in every session's catalog, relying entirely on the prompt-level rule (added in Task 6, S35) as the only safety net. Per the task doc: "removing the data from the context is the real fix." **Fix**: removed `roaster` from `CoffeeRow` and all six SQL SELECTs (no other logic depended on it — never used in a WHERE/ORDER BY, purely display); added `getAliases(coffeeIds)` (same batch-fetch pattern as the existing `getDescriptors()`) pulling each coffee's live, active `coffee_alias.platform_name` (priority 1 preferred); `buildCatalogText()` now prints `${alias ?? archetypeLabel} — ${archetypeLabel}` — alias only, roaster gone entirely, raw coffee name gone entirely.

**2. `ai_summary`/`surprise_note`/`three_voice_story` generation — Claude is told the coffee's raw name.** `getCoffeeSummary()`/`getCoffeeSurpriseNote()`/`getCoffeeThreeVoiceStory()` (`claude.ts`) build their prompt around whatever string is passed as `coffeeName` ("Write a 2–3 sentence tasting note for `\"${coffeeName}\"`..."). Their only caller, `fetchCoffeeDataForContent()`/`generateAndStoreAllContent()`/`generateAndStoreSummary()` (`backend/src/routes/coffees.ts`), was passing `data.coffee.name` — the coffee's raw internal name, the same field `sommelierRag.ts` was leaking above. **Per the task doc's explicit constraint, `claude.ts`'s three functions were not touched at all** — the fix is entirely at the call site: `fetchCoffeeDataForContent()` now also fetches the coffee's active `coffee_alias.platform_name`, and both callers pass `data.displayName ?? archetypeLabel ?? 'This coffee'` as `coffeeName` instead of the raw name.

**Verified against production Cloud SQL**: a spot-check of all 13 coffees with cached content (per the task doc's "query 10 records" instruction) found **all 13** contained the raw coffee name in at least one field pre-fix (zero direct roaster-name hits in the text itself — that leak was structural, in `sommelierRag.ts`, not in the generated text). Regenerated all 13 via the now-fixed `generateAndStoreAllContent(id, { force: true })`; re-spot-checked — 12/13 fully clean, one false positive (coffee 16's own generic name "Chocolate" is a substring of Claude's own word "chocolatey" in an unrelated clarifying-question response, not a name reveal). **Side note, not a regression**: coffee 16 (a "Flavored" add-on with no archetype and no cupping data — see `WHAT_WE_BUILT_DB.md`'s `coffee_category_assignment` entry) now gets Claude asking for more information instead of a generic note, because the previous prompt's only usable signal was literally its raw name ("Chocolate") — this coffee has no active alias or archetype to fall back to yet and isn't in active customer rotation.

**Not changed, per the task doc**: `claude.ts`'s `LIAM_BASE_PROMPT`, `RECOMMENDATION_SYSTEM_PROMPT`, `getRecommendation()`, `getCoffeeSummary()`, `getCoffeeSurpriseNote()`, `getCoffeeThreeVoiceStory()` — all untouched; `chatWithSommelier()` assembly logic, model routing, token/turn logic — all untouched. Steps 1/3/4 of the original Task 6 (voice prompt, intent addendums, smoke test) were already complete from the 2026-07-04 pass (S35) and were not re-run.

#### S39. Two Bloom follow-ups touch data adjacent to Liam's RAG, neither changes Liam (2026-07-12)
**Context**: not a Sommelier change — flagged for continuity, same as S37. Two follow-ups from `WHAT_WE_BUILT.md` #84:
1. New public `GET /api/axis/adjacency` reads `v_archetype_adjacency`, derived from `dial_coffee_relationships` — the same underlying table Liam's RAG separately queries via `v_dial_navigation` (`sommelierRag.ts`'s `alternatives`/`discovery` focus types, for bridge-hop coffee selection). Different view, same source table, no shared code path — `sommelierRag.ts` itself wasn't touched.
2. `GET /api/coffees/:coffeeId/hops` (the Bloom-facing hops endpoint from #80/S37) now uses `COALESCE(coffee_dimensions.platform_name, name)` for its dimension-name field, so hop link wording on `/bloom` matches the Bloom Dial's own vocabulary (e.g. "Intensity" not "Body"). Unrelated to Liam's own hop consumption in `sommelierRag.ts`.

No Liam prompt, RAG query, or chat behavior changed by either of these.

**Why it's on Liam's radar**: `backend/src/features/ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` (written the same session, ahead of the Bloom build) already flagged that a future enhanced `/coffees` "flavor intelligence" page is something Liam should eventually be able to point customers toward. The Bloom build is a different, more concrete instance of the same pattern: a public surface now exists over hop-graph data that used to be Liam-only. No Liam prompt/RAG changes were made — just worth knowing the hop graph now has a second consumer.

#### S40. The Bloom Part 10's shared cart promoted `FloatingCart` to layout-level — now also renders on `/sommelier` (2026-07-13)
**Context**: not a Sommelier change — flagged for continuity, same as S37/S39. `WHAT_WE_BUILT.md` #90 (The Bloom Part 10) moved `FloatingCart` (the cart icon plus a floating "Talk to Liam" icon button linking to `/sommelier`) out of a `BloomPage.tsx`-local render into `PublicLayout.tsx`, so every route wrapped in `PublicLayout` now renders it. `/sommelier` is one of those routes (nested under `PublicLayout`, gated by `RequireAuth`) — so a signed-in user on Liam's own chat page now also sees a floating "Talk to Liam" button pointing back at `/sommelier` (self-referential, redundant on that specific page) plus a cart icon, neither of which rendered there before this change. No Liam prompt, RAG query, or chat behavior changed — this is purely a side effect of a layout composition change made for Bloom's own shared cart, not something Part 10 was scoped to fix. Worth a small conditional-path fix (e.g. suppress `FloatingCart` when `pathname === '/sommelier'`, the same pattern `PublicLayout.tsx` already uses for its `noFooter` logic) whenever anyone next touches either `PublicLayout.tsx` or the Sommelier page.

#### S41. Find My Flavor Part 1 touches `users.ts`'s archetype-key bug; no Liam/Sommelier code path affected (2026-07-13)
**Context**: not a Sommelier change — flagged for continuity, same as S37/S39/S40. `WHAT_WE_BUILT.md` #91 redesigns `/find-my-flavor`'s returning-user screen and, along the way, fixes a bug in `backend/src/routes/users.ts` where `ARCHETYPES` was keyed by shorthand (`chocolate`/`balanced`/`spicy`) while the lookup derived its key via `archetype.name.toLowerCase()` — mismatched for 3 of 6 archetypes. Checked whether this touches Liam: it doesn't. `sommelierEvaluator.ts`, `sommelierRag.ts`, and `behavioralConfidence.ts` all read `archetype_name` (the display string, via `ar.name`) directly from SQL joins — none of them go through `users.ts`'s `ARCHETYPES` map or its `.toLowerCase()` key derivation, so none were affected by either the bug or the fix. The page's existing "Talk to our coffee sommelier" nav link (→ `/sommelier?entry=user_initiated`) is carried over unchanged, just restyled off-photo along with the rest of that nav list.

#### S42. Sensory Source Provenance gives Liam's flavor vocabulary documented WCR/SCA sourcing; no Liam code path affected (2026-07-13)
**Context**: not a Sommelier change — flagged for continuity, same as S37/S39/S40/S41. `WHAT_WE_BUILT.md` #92 added a `sensory_source` registry + full `sensory_lexicon_attribute` reference table (the WCR Sensory Lexicon 2.0, ~110 attributes) and linked every active `cupping_note` descriptor to its WCR source, plus sourced every `coffee_dimensions` axis (SCA CVA / WCR / platform). This is the vocabulary Liam's RAG catalog and flavor-wheel context are built from, but the feature only added new tables + nullable provenance columns — `sommelierRag.ts`'s queries against `cupping_note`/`coffee_dimensions` select specific columns (never `SELECT *`), so nothing it reads changed shape. No Liam prompt, RAG query, or chat behavior touched. Worth knowing for future work: `coffee_dimensions.sensory_lexicon_attribute_id` and `cupping_note.lexicon_section` now exist if Liam's RAG or prompt-building ever wants to cite a WCR source for a descriptor.

#### S43. Bloom Dial base data + seam positions populate the exact graph Liam's RAG reads; explicitly confirmed unchanged (2026-07-14)
**Context**: not a Sommelier change — flagged for continuity, same as S37/S39/S40/S41/S42. `WHAT_WE_BUILT.md` #93 is the closest any of these continuity notes has come to touching Liam directly: it populates `dial_coffee_relationships` (the hop graph) and `dial_archetype_positions` for the first time at real volume, and `sommelierRag.ts` reads both `v_dial_navigation` (built on `dial_coffee_relationships`) directly. Checked before writing anything: `sommelierRag.ts` only ever selects from `v_dial_navigation`, never `v_dial_positions` or `dial_archetype_positions` directly, and neither view's column shape changed — `v_dial_navigation` was untouched, `v_dial_positions` only gained a new `is_guest` column (additive). So Liam's RAG now has a real, connected hop graph to traverse (previously only 4 rows existed, all from Session 001) instead of an almost-empty one — a meaningful *quality* improvement to what Liam can recommend on "too strong"/"try something else" style feedback, but zero *code path* change. The 2 new `category_hop` rows (Bali Blue ↔ Experimental) are deliberately excluded from `v_dial_navigation` (inner-joins coffees on both sides) until category traversal is built, so Liam doesn't see them yet — expected, not a gap to fix here. The Part 2 seam (guest) positions are invisible to Liam by construction: `sommelierRag.ts` never reads `dial_archetype_positions`, so `is_guest` is irrelevant to it either way.

#### S44. Liam WAS affected by #94 after all — `getAliases()` was citing stale/duplicate coffee names, fixed (2026-07-15)
**Context**: S41/S42/S43 all confirmed "no Liam impact" by checking `sommelierRag.ts` against the specific tables/views a change touched. This one slipped through that pattern: `getAliases()` (the function providing "the only customer-facing identity Liam's catalog context may use") reads `coffee_alias.platform_name` directly — a column `WHAT_WE_BUILT.md` #94 explicitly declared "legacy/unread going forward" after moving slot names to `dial_slot_alias`, without first auditing every consumer of that column. Caught during a post-deploy audit (prompted by a direct question about whether all three build-log docs had been updated) — verified live against prod before fixing anything: **10 of 26 dial coffees** had a stale name mismatch between what Liam would cite and what the public site now shows (e.g. Liam still saying "Deep Cocoa" for 6-Bean Espresso Blend, renamed to "Full Cocoa" on-site days earlier; "Dark Grounded" for Uganda, now "Intense & Dark"). Fixed by joining `dial_slot_alias` the same way `GET /api/admin/coffee-alias` and the public endpoints already do, keeping the `coffee_alias.platform_name` fallback only for the 6 category-tagged coffees (Decaf/Half-Caf/Flavored/Experimental), which have no dial slot and correctly keep their own per-coffee identity — same fallback `/api/coffees/other-categories` (#95) uses. Also found and fixed the identical bug in the admin Inventory page (`GET /api/admin/inventory`) while auditing every remaining `coffee_alias.platform_name` read in the codebase — lower stakes (admin-only), but same root cause. Re-verified against prod post-fix: real dial coffees resolve to live slot names, the 3 category coffees with existing aliases (Decaf, Sleepwalker Half-Caf, Kopi Safari) keep their own distinct names, no unexpected duplicates. **Lesson for future continuity notes**: "confirmed unaffected" needs to be a grep across the whole `services/` and `routes/` tree for the specific column/table being deprecated, not just the view/table the current change directly touches.

#### S45. Bloom Dial base data Part 4 (UI corrections) — confirmed no Liam impact, applied S44's lesson (2026-07-15)
**Context**: not a Sommelier change — flagged for continuity per the S44 lesson above: grepped `sommelierRag.ts` for every table/endpoint `WHAT_WE_BUILT.md` #97 touched (`dial_slot_alias`'s 3 new rows, the new `/api/coffees/experimental` and `/api/coffees/archetype-order` endpoints, `blendResolver.ts`'s `resolveBlendForSlot` archetype-precedence fix) before writing this note, not just the ones a first glance suggested. `sommelierRag.ts` doesn't call any HTTP endpoint (it queries Postgres directly) and doesn't touch `resolveBlendForSlot` at all — that function is `blendResolver.ts`'s public-availability resolver, unrelated to Liam's RAG. `getAliases()` (fixed in S44, above) already correctly reads `dial_slot_alias` — 3 additional rows there is purely additive, no shape change. No Liam prompt, RAG query, or chat behavior touched by #97.

#### S46. Homepage (home-v3) regression fixes — confirmed no Liam impact (2026-07-15)
**Context**: not a Sommelier change — flagged for continuity per the S44 lesson: checked every backend file Liam's chat path touches (`sommelierEvaluator.ts`, `sommelierRag.ts`, `behavioralConfidence.ts`, `claude.ts`) against what `WHAT_WE_BUILT.md` #98 changed, not just the obvious surface. #98 is 100% frontend (`Home.tsx`, `Navigation.tsx`, `CAMILAS_UPDATES.md`) — no backend route, SQL query, or Firestore document touched. The restored `renderStageCTA()` reads `GET /api/users/homepage-state`, which is a completely separate endpoint/service (`userLifecycle.ts`/`classifyStage()`) from anything Liam's RAG or evaluator reads. The only nav-level connection to Liam is unchanged: the existing "Talk to Liam" entry points (nav/profile/etc.) still point at `/sommelier` exactly as before — the new mobile hamburger panel lists the same top-level nav links as the existing desktop nav, it doesn't add or remove a Sommelier entry point. No Liam prompt, RAG query, or chat behavior touched by #98.

#### S47. Unlisted About/Shop/How It Works from public nav + footer — confirmed no Liam impact (2026-07-15)
**Context**: not a Sommelier change — flagged for continuity per the S44 lesson: checked every backend file Liam's chat path touches (`sommelierEvaluator.ts`, `sommelierRag.ts`, `behavioralConfidence.ts`, `claude.ts`) against what `WHAT_WE_BUILT.md` #99 changed. #99 is 100% frontend nav/footer/admin-sidebar JSX (`Navigation.tsx`, `Footer.tsx`, `AdminLayout.tsx`) — no backend route, SQL query, RAG context, or Firestore document touched, and no schema change (no `WHAT_WE_BUILT_DB.md` entry this session). The "Talk to Liam" entry points (nav's `/sommelier` link where applicable, Profile's memory tab, `FlavorIntelligencePage.tsx`'s "Ask Liam" button) are all untouched — this session only removed `/about`, `/shop`, `/how-it-works` from the nav/footer, none of which are Sommelier entry points. No Liam prompt, RAG query, or chat behavior touched by #99.

#### S48. Find My Flavor Part 2 (results screen) now surfaces `RevealedPanel`'s "Talk to Liam about this coffee" link on this screen for the first time — confirmed no Liam impact (2026-07-16)
**Context**: not a Sommelier change — flagged for continuity per the S44 lesson, and specifically because this session's change (`WHAT_WE_BUILT.md` #61) makes a pre-existing Liam entry point reachable from a screen it never appeared on before. Replacing the just-finished-quiz results screen's chocolate-only mock dial with the shared `ArchetypeSection` (same component `/bloom` and the returning-user screen already use) means `RevealedPanel`'s "Talk to Liam about this coffee" link and coffee-strip-style Sommelier entry now render on this screen too — browser-verified present in the reveal panel. This is a new *entry point location*, not new *entry point logic*: the link itself, `RevealedPanel.tsx`, `PositionCard.tsx`, `usePositionCardData.ts`, `sommelierRag.ts`, `sommelierEvaluator.ts`, `claude.ts`, and every other file on Liam's actual chat path are unchanged — checked, per the S44 lesson, not assumed. `FlavorQuiz.tsx` itself gained no new Sommelier-related code beyond what already existed (the tie interstitial's existing "Talk to Liam →" button, unchanged).

#### S49. Profile Parts 1–3 fixed a standing Sommelier Task 1 bug (`taste_journey` never persisted); feedback v2 confirmed additive to `feedback_events` — no Liam impact otherwise (2026-07-18)

**Context**: not a Sommelier feature change, but this one directly touches Task 1's own output, so it gets full treatment rather than the usual one-line continuity check. `WHAT_WE_BUILT.md` #100 built the Profile page's "Flavor Memory" tab (`backend/src/features/profile_page/`), whose "Palate over time" section reads the exact `taste_journey` Firestore doc S9 describes.

**Real bug found**: `users/{uid}/taste_journey` is a 3-segment path. Firestore document references require an even segment count (collection/doc/collection/doc/…) — `firestoreDb.doc('users/{uid}/taste_journey')` in `quiz.ts` has thrown synchronously on every call since S9 shipped it, silently caught by that block's own try/catch (S9's own description says as much: "Fire-and-forget within a try/catch that logs errors" — nobody was watching those logs). **`taste_journey` has never actually persisted a single write.** Confirmed by reproducing the throw directly against production Firestore and by reading the doc via the Admin SDK before and after the fix. Fixed the write (`quiz.ts`) and the new read (`users.ts`'s `GET /api/users/flavor-memory`) to `users/{uid}/metadata/taste_journey` (4 segments) — the same working pattern `confidence_profile` already uses one collection over. `SOMMELIER_BUILT.md`'s own Firestore path table (above) and `WHAT_WE_BUILT_DB.md`'s path reference are both corrected to match.

**Confirmed this doesn't change any Sommelier behavior**: `TASTE_EVOLUTION` (the intent that conceptually depends on "did the archetype change") derives `archetypeChangedLastTwoQuizzes` from SQL `quiz_session` history via `userSignals.ts`, never from this Firestore doc — checked directly, not assumed. `sommelierRag.ts`, `sommelierEvaluator.ts`, and `claude.ts` don't reference `taste_journey` anywhere. The only user-facing effect of the fix is that "Palate over time" can now show real multi-entry history across retakes instead of always falling back to Profile's own single synthetic backfill entry — verified live: two retakes in the same session now produce two distinct `first_quiz`/`retake` entries where previously (and for every user before this fix) only the backfill entry ever appeared.

**Feedback v2 checked against `behavioralConfidence.ts`'s `feedbackAlignment` component (S8)**: the extended `POST /api/orders/:orderId/feedback` (Profile Part 2) adds `expectation` and populates `descriptors` (previously hardcoded `[]`) on the same `feedback_events` doc shape — `sentiment`/`rating`/`sValue`, the only fields `feedbackAlignment` actually reads, are computed identically to before. Purely additive; no Sommelier prompt, RAG query, or confidence-scoring logic touched.

#### S50. Profile Part 5 (feedback editing) touches three of Liam's own feedback consumers directly — not a continuity note, a real change (2026-07-18)

**Context**: `WHAT_WE_BUILT.md` #101 makes on-site feedback editable per order via superseding `feedback_events` docs. Unlike most entries in this run of continuity notes, this one genuinely changes code Liam depends on, so it's not "confirmed no impact" — it's "confirmed correct impact."

**What changed, in Liam's own files:**
- `behavioralConfidence.ts`'s `feedbackAlignment` component (S8) now filters out superseded docs before counting events/positive-alignment — a revised rating no longer double-counts alongside its replacement.
- `userSignals.ts`'s `hasRecentNegativeFeedback` (feeds the Sommelier's `RECOMMENDATION_MISS` trigger) dropped its `.limit(1)` and now explicitly skips superseded docs — a negative rating the customer later revised upward no longer keeps `RECOMMENDATION_MISS` firing.
- `sommelier.ts`'s `RECOMMENDATION_MISS` handler (the `excludeCoffeeIds` query, built from negative-sentiment `feedback_events`) now filters superseded docs the same way, before taking its top-10 — a coffee the customer un-negatived stops being excluded from Liam's recommendations.

**Verified directly, not assumed**: the DB/Firestore check in #101 confirmed a revised event's old doc actually carries `supersededAt` and the new one doesn't; re-read all three consumers listed above line-by-line against the new field to confirm each one's filter is correct (not just present). Did not independently re-run a live Sommelier session to observe `RECOMMENDATION_MISS` behavior end-to-end this pass — the underlying data-correctness (which doc counts) is verified, but the intent-selection UI itself wasn't re-exercised.

**Nothing else touched**: `claude.ts`'s prompts, `sommelierEvaluator.ts`'s intent priority/rules, RAG focus selection, and every other consumer of `getUserSignals()`/`computeBehavioralConfidence()` are unchanged — only the *filtering* of what counts as "current" feedback changed, not any scoring formula, weight, or prompt.

#### S51. Action links + dial-activity awareness — Liam's chat contract gains action markers and a new context field (2026-07-18)

**Context**: `WHAT_WE_BUILT.md` #102. Unlike most recent entries, this is a direct, intentional change to Liam's own prompt and response contract — full treatment.

**`LIAM_BASE_PROMPT` (`claude.ts`) gained one new section**, "Action markers": Liam may end a reply with `<<action:retake_quiz>>` (real archetype doubt or taste drift) or `<<action:open_dial>>` (a different position within the same archetype), at most one per turn, never on the opening turn, only once he's actually reached the recommendation — not as a placeholder while still asking questions. Explicitly told these are internal and never to be mentioned to the customer. Nothing else in the base prompt changed.

**`chatWithSommelier()`'s return shape changed** — it now also returns `actionTypes: Array<'retake_quiz' | 'open_dial'>`, parsed by checking for the literal marker substrings before stripping every `<<action:...>>` token (known or malformed) from the reply text that reaches the customer. This is a function signature change; both call sites (`/start`, `/message` in `sommelier.ts`) were updated in the same pass.

**New in `sommelier.ts`**: `resolveActions()` turns marker types into real payloads server-side — `open_dial` never trusts the LLM for an archetype or slot; it resolves the archetype from the session's own quiz-derived context (stored as `archetypeKey` in `sommelier_sessions.context_data` at session start) and looks up `user_bloom_dial_current_position` for a saved slot, omitting it (not guessing) when none exists. `getRecentDialActivitySummary()` reads the last ~30 `users/{uid}/dial_events` (Liam Dial Event Log's new Firestore collection — see `WHAT_WE_BUILT_DB.md`) and collapses them into a short per-archetype string, appended to `enrichedOpeningContext` for `EXPLORATION`/`PROFILE_AMBIGUOUS` sessions only. Both are new, not extensions of anything existing.

**Seed addendums touched, live config not yet updated**: `PROFILE_AMBIGUOUS`, `TASTE_EVOLUTION`, `RECOMMENDATION_MISS`, and `EXPLORATION` in `sommelier_config_seed.ts` each gained one sentence nudging the relevant marker for that intent's own goal; `PROFILE_AMBIGUOUS`/`EXPLORATION` also gained permission to reference `recentDialActivity` when present, never invented. Per this doc's own established pattern (S from Task 6's voice reset), a seed-file edit alone does not reach the live `config/sommelier` doc — Dana needs to review the exact copy (in the seed-file diff) and apply it via the admin portal before Liam actually emits markers or references dial activity in production. Until then this ships inert: the code paths exist and are wired, but the live prompt doesn't yet contain the instruction that triggers them.

**Nothing else touched**: intent selection/priority, `evaluatorRulePriority`, token/turn logic, model routing (Haiku/Sonnet), and `RECOMMENDATION_SYSTEM_PROMPT` (the separate content-generation system) are all unchanged.

**Not verified this pass**: no live conversation was driven to confirm Liam actually emits a marker at the right moment once the addendum copy goes live (it currently can't, per the paragraph above) — the parsing/stripping/resolution code was exercised only by clean `tsc --noEmit`, not a real model response.

#### S52. Profile Part 6 — journey-write/bc coupling removed; no other Liam impact (2026-07-18)

**Context**: `WHAT_WE_BUILT.md` #103, issue A. `quiz.ts`'s fire-and-forget post-quiz block previously called `computeBehavioralConfidence(uid)` and only wrote `users/{uid}/metadata/taste_journey` if that succeeded, both inside the same try/catch — a `computeBehavioralConfidence` failure would silently also drop the journey write. Split into two independent try/catches: `computeBehavioralConfidence` now runs best-effort first (its own failure just means the journey entry's `confidenceLevel` is `null` instead of a real level), and the journey write always runs regardless of whether it succeeded.

**`computeBehavioralConfidence()` itself is unchanged** — same weights, thresholds, component formulas, Firestore write to `confidence_profile`. Only its caller's error handling changed, not the function's own internals or contract.

**Nothing else touched**: intent selection, RAG, `sommelierEvaluator.ts`, token economy, chat contract, and every other consumer of `computeBehavioralConfidence()`/`getUserSignals()` are unchanged.

#### S53. Liam SMS Dial Question — outbound copy, reply parsing, and a live JSON-fence parsing bug fixed (2026-07-18)

**Context**: `WHAT_WE_BUILT.md` #104. Direct change to `liamSmsFeedback.ts` — Liam's SMS channel, not a continuity note.

**Outbound**: `schedulePostDeliveryMessage`'s primary and fallback SMS bodies both now ask "lighter or bolder than you expected?" alongside the existing open question, giving the SMS channel the same closed dial-direction question on-site feedback v2 already asks. Voice-checked against `SOMMELIER_TASK_6_VOICE.md`: customer language ("lighter or bolder"), not the dimension name. Length-checked programmatically, not assumed — worst-case realistic name+blend stays at 150/160 chars; the question is structurally guaranteed present in both variants (only the greeting shortens for the fallback).

**Inbound**: the Haiku reply-parse prompt gained a fourth extraction field, `expectation`, with an explicit "never guess — null if not addressed" instruction, matching the extraction discipline the existing sentiment/rating/descriptors fields already had. `feedback_events` now carries `expectation` on the SMS channel too, matching on-site v2's field name exactly.

**Signal write reuses Part 2's resolver, doesn't duplicate it**: extracted the coffee → archetype → dominant-dimension → `dial_position_signal` insert logic out of `orders.ts` (where Part 2 had inlined it) into `backend/src/services/dialPositionSignal.ts`, and both channels now call the one function. No `dial_position_signal`/`dial_source_weight` schema change needed — both already had `sms_feedback` as a valid `source` since #75/#84, this task just started actually using it.

**A real bug, not hypothetical**: testing the reply parse against the Anthropic API directly (not mocked) surfaced that Haiku currently wraps its JSON response in markdown code fences on this prompt, and the pre-existing `JSON.parse(raw)` (unchanged since Sommelier Task 5) has always lacked fence-stripping — meaning it would throw on real replies and silently default `sentiment`/`rating`/`descriptors` to neutral/3/[] for every one of them, not just fail to extract the new field. Predates this task; fixed in the same block since that's where it lives. Re-verified with the exact three replies from the spec's own testing section post-fix — all parse and extract correctly (`"loved it, way bolder than I expected"` → `bolder`, `"it was nice"` → `null`, `"a bit weak honestly"` → `lighter`).

**Nothing else touched**: scheduling rules (orders 1–2 only, 10-day delay, idempotency), opt-in logic, the never-ask-twice invariant, descriptor-chip extraction, and `RECOMMENDATION_SYSTEM_PROMPT` are all unchanged, per the spec's explicit scope.

#### S54. FIX-01 mobile nav menu accessibility — confirmed no Liam impact (2026-07-19)

**Context**: `WHAT_WE_BUILT.md` #105. Pure `Navigation.tsx` change (Escape-to-close, focus trap, body scroll lock, focus return on the already-existing mobile menu). `Navigation.tsx` has no Sommelier/Liam code path — it doesn't touch `/sommelier`'s `RequireAuth` wrapper, the chat UI, action links, or any Firestore/SQL Liam reads or writes. Continuity note only.

#### S55. Image pipeline (GCS bucket + registry) — confirmed no Liam impact (2026-07-19/20)

**Context**: `WHAT_WE_BUILT.md` #106. New GCS bucket + Cloud Function + `frontend/src/design/assets.ts` registry, migrating 10 frontend component files off local image imports. None of the touched files are on any Liam/Sommelier code path — no `Sommelier.tsx`, `sommelierEvaluator.ts`, `claude.ts`, RAG, token economy, or chat-contract file was read or written. `Navigation.tsx` and `Footer.tsx` were touched again in this pass (brand-logo source swapped to the registry) but only for the same nav chrome S54 already cleared — nothing new for Liam here either. Continuity note only.

#### S56. FIX-02 homepage video/loading behavior — confirmed no Liam impact (2026-07-20)

**Context**: `WHAT_WE_BUILT.md` #107. Video compression + `loading="lazy"`/`preload`/poster changes confined to `Home.tsx` and the shared `assets.ts` registry (two new `videoAssets` poster keys). No Sommelier/Liam file touched — `Home.tsx`'s only Liam-adjacent surface (the signed-in lifecycle CTA, `renderSignedInCTA`/`renderStageCTA`) was explicitly left untouched, confirmed via `git diff`. Continuity note only.

#### S57. Step 01 (A1) archetype canon cleanup — confirmed no Liam impact (2026-07-20)

**Context**: `WHAT_WE_BUILT.md` #108. Dropped Experimental from two hardcoded marketing taxonomy lists (`About.tsx`, `HowItWorks.tsx`) and fixed baked-in "SPICY & EARTHY" bag artwork text to "EARTHY" (`bag-spicy.svg`). No Sommelier/Liam file touched — not `Sommelier.tsx`, `sommelierEvaluator.ts`, `claude.ts`'s `RECOMMENDATION_SYSTEM_PROMPT` (still says "Spicy & Earthy," deliberately left alone per #61's same-scoped decision), RAG, token economy, or any chat-contract file. `FlavorQuiz.tsx` (the quiz results screen, which does feed Liam's tie interstitial) was read during the audit but not edited — already canonicalized to "Earthy" since #61, no experimental-flag logic touched. Continuity note only.

#### S58. Step 02 (B1) GA4/Pixel + quiz funnel events — confirmed no Liam impact (2026-07-20)

**Context**: `WHAT_WE_BUILT.md` #109. `FlavorQuiz.tsx` was genuinely edited this time (unlike #108) — added a per-session `crypto.randomUUID()` ref, a `QuizStart`/`QuizComplete` tracking call in `handleAnswerSelect`/`handleNext`, and a two-line reset in `handleRetake`. None of it touches the tie interstitial, `archetypeNameMap`, Liam entry-point links, or any prop/state `Sommelier.tsx`/`sommelierEvaluator.ts` reads — purely additive analytics side-calls alongside the existing scoring flow, no branching logic changed. New backend route/table (`POST /api/quiz/event`, `quiz_funnel_event`, `features/marketing/funnelEvents.ts`) and the new `NewsletterModal.tsx`/`PreLaunch.tsx` tracking calls are nowhere near the Sommelier/Liam surface either. Continuity note only.

#### S59. Step 04 (A2) firm email gate + lifecycle — confirmed no Liam impact (2026-07-20/21)

**Context**: `WHAT_WE_BUILT.md` #110. `FlavorQuiz.tsx` gained the email-gate state block (`postQuizEmail`, `emailGateUnlocked`, the two subscribe-sync effects) and gates `ArchetypeSection`/`CompareOverlay` behind it — none of it touches the tie interstitial, branch-question flow, `archetypeNameMap`, or any Liam entry-point link (Sommelier CTA, "Talk to Liam" links unchanged). The signed-in lifecycle update (`refreshLifecycleState` via `POST /api/quiz/results`) is pre-existing code, not touched — confirmed via `git diff` on `routes/quiz.ts` showing zero lines changed in that route. New `PostQuizEmailGate.tsx` component and the extended `newsletter.ts`/`users.ts` routes are nowhere near the Sommelier/Liam surface. Continuity note only.

#### S60. Step 04b — FIX: firm gate reveal order + card typography — confirmed no Liam impact (2026-07-21)

**Context**: `WHAT_WE_BUILT.md` #111. Fixed the actual quiz-completion path (`fromWrapRef` branch) so Section 1's free reveal (name/wallpaper/bag/description, via a new `Section1Reveal` component) renders before the email gate instead of being hidden behind it, and swapped `PostQuizEmailGate.tsx`'s inverted headline/supporting-line styling back to spec. Neither change touches the tie interstitial, branch-question flow, or any Liam entry-point link — `Section1Reveal` is purely presentational (reads `archetype.name`/`.wallpaper`/`.bag`/`.shortDescription`, all pre-existing local data, no new fetch), and the typography swap is scoped to `PostQuizEmailGate.tsx`'s own JSX. `ArchetypeSection`'s gating logic (and therefore its Liam-adjacent "Talk to Liam" links inside `RevealedPanel`) is unchanged — only *when* it renders relative to Section 1 was touched, not what it renders. Continuity note only.

#### S61. Step 04c — COPY: email-gate sub-line + button text — confirmed no Liam impact (2026-07-21)

**Context**: `WHAT_WE_BUILT.md` #112. Two literal strings in `PostQuizEmailGate.tsx` (sub-line, button label). No logic, props, or component boundaries touched — nowhere near the Sommelier/Liam surface. Continuity note only.

#### S62. Step 07 (A3) share-your-match — confirmed no Liam impact (2026-07-21)

**Context**: `WHAT_WE_BUILT.md` #113. New standalone static HTML pages (`frontend/public/match/*`) are outside the React app entirely — no Sommelier/Liam surface exists there at all. `ShareMatchRow.tsx` is new, self-contained, and only reads `archetypeName`/`shareSlug` props; its two `FlavorQuiz.tsx` insertion points are both inside the free Section 1 reveal, nowhere near the tie interstitial, branch flow, or any Liam entry-point link. Continuity note only.

#### S63. Step 06 (B3) reporting views + admin Marketing links — confirmed no Liam impact (2026-07-21)

**Context**: `WHAT_WE_BUILT.md` #114. Pure marketing-reporting plumbing — 4 new SQL views over `newsletter_subscriber`/`quiz_funnel_event`/`"order"`, a `reporting_ro` DB role, and an admin dashboard card row. None of it reads or writes any Sommelier/Liam table (`sommelier_sessions`, `sommelier_messages`, `user_tokens`, `token_events`, `dial_*`), and `AdminDashboard.tsx` is nowhere near `AdminSommelierConfig.tsx`/`AdminSommelierFlow.tsx`. Continuity note only.

#### S64. Step 03 (B2) compliance pack — confirmed no Liam impact (2026-07-21)

**Context**: `WHAT_WE_BUILT.md` #115. New `ConsentBanner.tsx`, `Privacy.tsx`, `Terms.tsx`, and an `analytics.ts` consent-default change — none of it touches `Sommelier.tsx`, `sommelierEvaluator.ts`, or any `sommelier_*`/`liam_*` table. The one adjacent detail: `Privacy.tsx`'s copy plainly describes Liam (built on Anthropic's Claude) as an account-data processor, since the policy needs to be accurate about what the site actually does — this is prose in a legal page, not a code path, and reads no Sommelier state. `PostQuizEmailGate.tsx`/`FlavorQuiz.tsx` were touched only to append a consent-copy line and a footer link respectively, both outside the gate/reveal/tie-interstitial logic S59–S61 already tracked. Continuity note only.

#### S65. Step 03b — "Nature of Recommendations" clause on /terms — confirmed no Liam impact (2026-07-21/22)

**Context**: `WHAT_WE_BUILT.md` #116. One new static section in `Terms.tsx`, mentioning matching/recommendations only in the abstract (legal disclaimer language) — no reference to Liam by name, no Sommelier code or table touched. Continuity note only.

#### S66. M1 — Welcome Journey Mailchimp templates — confirmed no Liam impact (2026-07-23)

**Context**: `WHAT_WE_BUILT.md` #117. Five HTML/text email templates + a setup doc, all new files under `launch/40_email-marketing/templates/` — no `backend/`/`frontend/` code touched at all, so nothing in the Sommelier/Liam surface (`Sommelier.tsx`, `sommelierEvaluator.ts`, `sommelier_*`/`liam_*` tables) was anywhere near this change. Email 1 does introduce a "Meet Liam, your coffee sommelier" paragraph and mentions Liam again in Email 2 — both are static marketing prose describing Liam to a prospective subscriber, the same kind of accurate-description case already logged in S64 for `Privacy.tsx`, not a code path that reads or writes any Sommelier state. Continuity note only.

#### S67. Pricing update ($32/12oz, $185/5lb) + removed hardcoded price fallback — confirmed no Liam impact (2026-07-24)

**Context**: `WHAT_WE_BUILT.md` #118. Touched `coffees.ts` (`BLOOM_DEFAULT_PRICE_CENTS` removed, `buildSlotsForArchetype`/`GET /api/coffees/other-categories` price logic), `admin.ts` (comments only), `schema.sql` (comments only), a new migration, and the Bloom Dial commerce components (`AdminCoffees.tsx`, `ArchetypeSection.tsx`, `PositionCard.tsx`, `OtherCategoryCard.tsx`, `usePositionCardData.ts`, `types.ts`) — all pricing/commerce surface, none of it Sommelier/Liam-adjacent. `RevealedPanel.tsx` (the component that does carry a "Talk to Liam" link) was checked and confirmed to render no price data at all — grepped for `retailPriceCents`/`formatPrice`, zero matches. Continuity note only.

#### S68. Guest identity (Firebase Anonymous Auth) — sommelier routes gained the real-account gate, no other Liam impact (2026-07-28)

**Context**: `WHAT_WE_BUILT.md` #119. Firebase now issues every visitor an anonymous identity on first page load, and `admin.auth().verifyIdToken()` already accepts anonymous ID tokens unchanged — so without an explicit gate, an anonymous guest with no real account could technically have started reaching `requireAuth`-only routes, including all six `sommelier.ts` routes. All six (`/evaluate`, `/start`, `/:sessionId/message`, `/sessions`, `/:sessionId/messages`, `/:sessionId/close`) now chain a new `blockAnonymousAuth` middleware after `requireAuth`, returning `403 anonymous_not_allowed` for anonymous callers — per the guest_identity spec's explicit decision to keep Liam real-account-only for now, independent of any future "Liam for guests" question. Nothing inside `sommelierEvaluator.ts`, `sommelierRag.ts`, `chatWithSommelier()`, token/turn logic, or the RAG focus types changed — this is purely an added gate at the route layer, same pattern as the token/household/order/company-gift routes gained in the same change.

#### S69. Guest identity follow-up — RequireAuth.tsx tightened guard also wraps /sommelier, confirmed reinforcing not changing — no Liam impact (2026-07-29)

**Context**: `WHAT_WE_BUILT.md` #120. `RequireAuth.tsx`'s redirect condition changed from `if (!user)` to `if (!user || isGuest)` to stop anonymous guests from reaching account-only pages. `/sommelier` is one of the two routes wrapped in `RequireAuth` (the other being the newly-added `/profile`) — but Liam's six routes already independently gained `blockAnonymousAuth` at the backend layer in S68/#119, so an anonymous guest could never actually complete a session even before this change; this just adds a matching frontend redirect (to `/sign-in`) before the page loads at all, instead of the page loading and then every API call 403ing. No change to `sommelierEvaluator.ts`, `sommelierRag.ts`, `chatWithSommelier()`, token/turn logic, or RAG focus types. Continuity note only.

#### S35. Task 6 — Liam voice reset (2026-07-04)
Full execution of `SOMMELIER_TASK_6_VOICE.md`. Three files changed + live Firestore config patched.

**`backend/src/services/claude.ts` — `LIAM_BASE_PROMPT` replaced:**
- Added character definition: "the brilliant friend who knows everything about coffee — not the expert giving a lecture"
- Sensory language rules with Right/Wrong examples: "something tart that arrives quietly in the finish" vs "medium-high citric acidity profile"
- Confidence rules with Right/Wrong examples: "Crosshatch. That's where I'd land." vs "Based on your responses, Crosshatch might be worth considering."
- Brand values expanded: Guide Don't Educate, Remember Never Reset, Quiet Respect, Calm is a Feature, Customer Directed System Guided
- Generational register guide embedded with Gen Z / Millennial (default) / Gen X / Boomer calibration
- Questions are optional: statement or recommendation often better than a question
- History is internal context: never narrate back, never ask customer to explain their own pattern
- Opening turn: 2-sentence max, Good/Bad examples pinned

**`backend/src/routes/sommelier.ts` — generation injection:**
- Added `getGeneration(dateOfBirth)` helper at top of file (returns Millennial as default when no DOB)
- Added `date_of_birth` to the existing quiz session query (already JOINs `user_profile`)
- Built `enrichedOpeningContext` = `openingContext` + `\nCustomer generation: ${generation}. Adjust register accordingly.`
- Passed `enrichedOpeningContext` to both `chatWithSommelier()` and the session `context_data` INSERT

**`backend/src/db/seeds/sommelier_config_seed.ts` — intent addendums rewritten:**
All 6 intents updated. Key changes:
- `PROFILE_AMBIGUOUS`: removed "build a picture" lecture framing → "Let the picture build from their answers"
- `RECOMMENDATION_MISS`: removed "ask what felt off" (WHY question) → "open a new direction, don't reference what didn't work"
- `TASTE_EVOLUTION`: removed "explore what may have changed: travel, time of day" (WHY) → "don't mention the change, start fresh, use previous only to anchor contrast"
- `DISCOVERY_SEEKER`: tightened — removed archetype-match framing, kept contrast-lead instruction
- `CONVERSION`: removed "reassuring" framing → one clear recommendation, no urgency
- `EXPLORATION`: kept spirit, tightened to "let the direction emerge"

**Firestore live config patched** via `backend/scripts/update-intent-addendums.mjs` (Node `--env-file` + firebase-admin direct write). Seed file alone doesn't update existing config documents.

#### S34. Liam prompt — ban history-narration, tighten opening template (2026-07-04)
Bad opener observed in production: *"You've been moving around quite a bit — what's shifted for you since the last time?"*

Changes to `LIAM_BASE_PROMPT` in `backend/src/services/claude.ts`:
- **Never-say list extended**: "What's shifted for you", "What changed since last time", "Why the change", and all variants of asking the customer to explain their history.
- **History is internal context only**: Liam uses past data silently. He never narrates it back ("you've been moving around", "you've tried a lot of directions"). That information informs recommendations; it is not the topic of conversation.
- **Opening turn template tightened with Good/Bad examples**:
  - Good: *"You're in the earthy range. Want to stay there or try something different?"*
  - Good: *"Last time you went fruity. Same direction or something new?"*
  - Bad: *"You've been moving around quite a bit — what's shifted for you?"* (exact live example)
  - Bad: *"You've tried a lot of different directions. What are you looking for now?"*

**Refinement pattern**: bad output from live session → exact phrase added to never-say list + added as "Bad:" example. Concrete examples are more reliable than abstract rules for blocking specific model behaviors.

#### S33. Liam — demographic tone calibration, brand values, register mirroring (2026-06-28)

**`sommelierEvaluator.ts`** — Stage 1 demographic query (moved to `userSignals.ts` as of S36; `sommelierEvaluator.ts` now reads `age`/`generation`/`householdType` off the shared `getUserSignals()` result instead of running this query itself):
```sql
SELECT up.date_of_birth, up.household_id,
       (SELECT COUNT(*) FROM user_profile up2 WHERE up2.household_id = up.household_id) AS household_size
FROM user_profile up WHERE up.firebase_uid = $1
```
- Computes `age`, `generation` (Gen Z/Millennial/Gen X/Boomer), `householdType` (solo/family).
- Added `demographicLine` to the Haiku Stage 2 prompt along with a tone calibration guide.
- Stage 2 Haiku briefing now ends with a tone note: *"Tone: direct, no-nonsense — Gen X."* which Liam receives as part of `openingContext`.

**`claude.ts`** — `LIAM_BASE_PROMPT` updated:
- Five brand values listed explicitly at the top.
- "Serious" replaces "calm, direct" as the default tone descriptor.
- Mirror rule: match the customer's register within 1 turn.
- Generation tone guide embedded in the prompt.
- Questions changed from mandatory to contextual — a statement is often the right move.
- WHY-question ban retained from S32.

**Prompt refinement guidance** (for ongoing tuning):
- Bad output → add to "Never say" list with exact phrase.
- Good output → add as a "Good:" example in the relevant section.
- Read 5–10 Firestore transcripts monthly; three instances of the same problem = a prompt fix.
- Firestore `config/sommelier` → `systemPromptAddendum` / `conversationGoal` per intent = no-deploy tuning lever.
- Hard rules (sold-out filtering, token limits) belong in code, not the prompt.

#### S32. Liam prompt — ban motivation questions, explicit opening rule (2026-06-28)
Off-brand opener example: "What's drawing you toward earthy now — did something click?" — asks WHY, uses poetic phrasing, sounds presumptuous.

Changes to `LIAM_BASE_PROMPT` in `backend/src/services/claude.ts`:
- **Never-say list**: bans "What's drawing you toward X", "Did something click", "What stuck with you", and any WHY question.
- **Direction questions**: Liam asks where to go next, not why the customer feels the way they do. "Do you want to stay with X or try something different?" — one-word answerable.
- **Opening-turn rule**: max 2 sentences. Acknowledge what's known. Ask one direction question. Pinned example: *"You've been in the earthy range. Want to stay there or try something different?"*

#### S31. Sommelier UI fixes post-redesign (2026-06-28)
1. **Nav overlap**: Navigation is `position: fixed, top: 0, height: 64px`. Sommelier container changed to `position: fixed, top: 64px, left: 0, right: 0, bottom: 0` so it sits flush below the nav without overlap.
2. **Title**: "Sommelier Concierge" → "Coffee Sommelier" in the sidebar header.
3. **Scroll jump**: `messagesEndRef.scrollIntoView()` was causing the browser window to jump on every message. Replaced with `scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight` targeting the inner `overflow-y-auto` div directly. Added `scrollContainerRef` to the scrollable body div.
4. **Buy tokens**: Added below the token balance in the sidebar footer. Navigates to `/shop` when `purchaseEnabled` is `true` in `config/sommelier`; shows "coming soon" alert otherwise. Placeholder until Stripe is connected.

#### S30. Sommelier page redesign — full-screen Claude/ChatGPT-style layout (2026-06-28)
Rebuilt `Sommelier.tsx` from a constrained page embedded in the site layout to a dedicated full-screen app experience.

**Layout changes:**
- `PublicLayout.tsx`: `/sommelier` added to full-screen routes (no nav, no footer, no newsletter modal) — same treatment as `/find-my-flavor`
- Page is now `fixed inset-0` with a left sidebar + main column split
- Sidebar: "Axis & Bloom" / "Liam" / "Sommelier Concierge" header, past sessions list (fetched from `GET /api/sommelier/sessions` on mount), token balance pinned at bottom, "+ New conversation" resets to a fresh session
- Mobile: sidebar hidden, revealed via hamburger → animated spring drawer with backdrop overlay
- Coffee names moved from a pill-strip header into the conversation itself — subtle `·`-separated line above the first message
- Input bar: `rounded-2xl` integrated design with up-arrow send button; token + turn status moved below the input
- Max-width column: `max-w-2xl mx-auto` keeps the prose thread readable at wide screen widths

**What stayed the same:** prose thread message style (`LIAM`/`YOU` labels + paragraphs, `space-y-10`, no bubbles).

#### S29. Liam prompt rewrite — brand-aligned voice (2026-06-27)
**Problem**: The original `LIAM_BASE_PROMPT` produced formal sommelier language ("palate", "what flavor stuck with you today"), long responses (180-word limit, 400 max_tokens), and no grounding in Axis & Bloom's brand values or the customer's existing profile.

**Source**: Brand Strategy & Visual Foundations Brief (`misc/Brand Strategy & Visual Foundations Brief/`). Key principles applied:
- *Guide, Don't Educate* → banned coffee vocabulary in customer-directed questions
- *Remember, Never Reset* → explicit instruction to use the customer's taste profile, never treat them as a blank slate
- *Clarity Over Complexity* → 80-word response limit + max_tokens reduced 400 → 200
- *Calm is a Feature* → voice rules: "calm, direct, unhurried. Never enthusiastic, never salesy."
- *Customer Directed, System Guided* → "The customer sets the pace. Follow their lead."

**File changed**: `backend/src/services/claude.ts` — `LIAM_BASE_PROMPT` constant and `max_tokens` in `chatWithSommelier()`.

#### S28. Conversation messages moved from Cloud SQL to Firestore (2026-06-27)
`sommelier_messages` SQL table is now legacy. All new message writes go to `users/{uid}/sommelier_sessions/{sessionId}/messages/{auto-id}` in Firestore.

**Why**: Conversation turns are documents, not relational data. No cross-table joins are needed — messages are always fetched as an ordered list for one session.

**What stayed in PostgreSQL**: `sommelier_sessions` — it has relational ties (token_events FK, turn_count state machine, is_closed flag, context_data JSONB for the RAG catalog) that are genuinely relational.

**Ordering**: A `seq` field (integer, 0-based) is written with each message. Opening = 0, first user message = 1, first reply = 2, etc. History queries use `.orderBy('seq')`. This avoids any ambiguity from server timestamp collisions on back-to-back writes.

**Rollback**: If token spend fails after saving the user message, the user message Firestore doc is deleted by doc reference (no SQL delete needed).

---

### HOME Task 1 — Config Source of Truth (2026-07-30)

**Config source of truth, declared**: the admin portal's live `config/sommelier` Firestore document is canonical. Seed files (`DEFAULT_SOMMELIER_CONFIG`) exist only to populate a fresh environment — a seed edit that matters must be pushed live through the mechanism below, never assumed to take effect on its own.

#### S70. Seed-vs-live drift indicator + one-click apply, closing the S35/S51 trap

**Problem this closes**: S35 (Task 6 voice reset) and S51 (action-marker addendums) both edited `sommelier_config_seed.ts` expecting the change to reach production, and both shipped inert because `seedSommelierConfig()` is a no-op once `config/sommelier` exists — the only way either fix actually reached prod was an ad-hoc one-time script (`backend/scripts/update-intent-addendums.mjs`). This task replaces that ad-hoc pattern with a product feature so it can't happen a third time.

**1. Named seed export** (`backend/src/db/seeds/sommelier_config_seed.ts`): the default config object is now `export const DEFAULT_SOMMELIER_CONFIG` — a pure refactor, no values changed. `seedSommelierConfig()` now spreads it (`{ ...DEFAULT_SOMMELIER_CONFIG, updatedAt: FieldValue.serverTimestamp() }`) instead of inlining the object.

**2. `GET /api/admin/sommelier/config-drift`** (`backend/src/routes/admin.ts`, admin-gated via the router's existing `requireAdmin`): deep-compares `DEFAULT_SOMMELIER_CONFIG` against the live document. `diffSommelierConfig()` recurses through plain objects only — arrays and primitives are leaf values compared by `JSON.stringify` equality — and emits one `{ path, seedValue, liveValue }` entry per differing dot-path. Keys present on only one side surface the same way (the missing side's value is `undefined`), so "differences" and "only-in-one-side keys" are one unified list, not two. Top-level `updatedAt` is skipped.

**3. `POST /api/admin/sommelier/config-apply`**: body `{ paths: string[] }`. For each requested path, looks up the value in `DEFAULT_SOMMELIER_CONFIG` (skips — doesn't error — any path the seed doesn't have) and writes via `configRef.update({ [path]: value, ... })`. Firestore's dot-notation field-path `update()` merges at the leaf: sibling keys and any path not listed survive untouched, which is what makes this safe to call with a partial selection rather than a full-document overwrite. Writes an audit doc to `config/sommelier/audit/{autoId}` (`uid`, `email`, `paths`, `at` — 4 segments, even, per house convention #6) via `req.uid`/`req.email` off the existing `requireAdmin` auth.

**4. Admin UI** (`AdminSommelierConfig.tsx`): a new "Config Source of Truth" section above the existing config editor. Badge reads "seed differs from live: N fields" when drift exists, or a quiet "seed and live match" line when it doesn't. Each diff row is a checkbox (all pre-checked) showing the path plus truncated seed/live values; an "Apply N selected" button posts to config-apply and reloads both the drift list and the config form. One sentence declares the source-of-truth rule directly in the UI.

**Verified against production `config/sommelier`** (there is no separate dev Firestore project — `axis-and-bloom-prod` is the only one configured; ran the check directly against it with full cleanup, per house convention #5): temporarily added a live-only test key and simulated a seed/live diff on `ragLimits.maxCoffees` — the drift logic reported exactly those two paths (the live-only key with `seedValue` undefined, the numeric diff with both values correct). Applying only the `ragLimits.maxCoffees` path updated it correctly, left the live-only test key untouched (confirming the dot-path update doesn't clobber siblings), and wrote a correct audit doc. `onSnapshot` fired on every write with no listener restart needed. All test data (the temp key, the value change, the audit doc) was reverted/deleted immediately after; the live document was back to its original state at the end of the run. `tsc --noEmit` clean on the backend.

**Out of scope, per the task spec**: no config values changed, no changes to `sommelierConfig.ts`'s listener, `claude.ts`, or `sommelier.ts`.

---

### HOME Task 2 — Modes & Topic Router (§4.1, §4.2, §4.6, §4.7) (2026-07-30)

#### S71. Turn-level topic router, two response contracts, mode-aware context assembly, model policy

**Context**: `HOME_TASK_2_MODES_AND_ROUTER.md`. The largest plumbing task in `home_v3` — everything in Phase 1 speaks through this. Gives Liam a second response contract (expertise, alongside the existing matching contract) selected per turn by a new topic router, shrinks the catalog block on knowledge-dominant turns, and routes those turns to the expertise model regardless of the existing keyword/length heuristic. Intent selection, priority, and the six-intent evaluator are completely untouched — this sits one layer beneath intent, exactly as designed.

**1. `backend/src/services/topicRouter.ts`** (new): `routeTopic(message, sessionContext)` — keyword rules first, read from `config/sommelier.topics` (per-topic keyword list + `mode: 'expertise' | 'matching'`), checked in `config.topicRouter.priority` order. A confident match this turn always wins. Failing that, the previous turn's topic carries forward (stickiness) for up to `config.topicRouter.stickyDecayTurns` (seed default 2) turns of silence before clearing. No match and no live sticky topic → `topic: null`, `mode: 'matching'` — exactly today's Liam, per §4.1's asymmetric-misroute-cost rule (unsure → terse, never a lecture).

**2. `claude.ts` — `assembleSystemPrompt()` extracted as its own exported pure function**, called by `chatWithSommelier()`. This is the one structural change worth calling out: it's a pure function of `{ session, catalogContext, mode, config }` with no network call, specifically so the byte-for-byte verification below didn't require mocking the Anthropic client. `chatWithSommelier()` gained an optional `mode?: 'matching' | 'expertise'` param, defaulting to `'matching'` — every existing call site (`/start`, and `/message` before this task) keeps matching-mode behavior exactly as it was.

**3. Guardrail sentences added to `LIAM_BASE_PROMPT`** (S32–S34 format, short rules + Right/Wrong): caffeine/health (general facts only, explicit carve-out for medication/pregnancy/children → warm deferral to a professional), equipment (category guidance only, never specific models or prices), origins (speak only from provided catalog/story context, never invent a detail — the full story layer is Task 5's job, this just lands the rule). These apply in **both** modes — they're in the base prompt, not a mode-conditional addendum.

**4. Two response contracts.** Matching mode: unchanged — same 80-word rule (still lives in `LIAM_BASE_PROMPT`'s Tone section, untouched), `max_tokens` now reads from `config.responseContracts.matching.maxTokens` (seed default 200, same number as the old hardcoded value — a config-driven refactor, not a behavior change). Expertise mode: a new addendum appended last, only on knowledge-dominant turns — length instruction ("answer as short as fully answers the question... up to ~200 words when it genuinely needs that much") + the numbers carve-out verbatim per §4.2 ("1:16 and 94°C are the answer, not jargon... the technical register — 'percolation,' 'extraction yield,' 'TDS' — stays banned"), both sourced from `config.responseContracts.expertise`, not hard-coded.

**5. Mode-aware context assembly (§4.6).** On an expertise-mode turn, the full `catalogText` is omitted from the system prompt entirely (`config.contextAssembly.omitCatalogInExpertiseMode`, seed default `true`) rather than re-queried or trimmed. **Status: resolved by HOME_TASK_6 (S79, 2026-08-02).** At the time this task shipped, the spec's "one-line stub naming the customer's current coffee" path wasn't implemented — there was no "current coffee" concept tracked anywhere in the schema until brew cards existed, so the stub branch had nothing to stub from; the omit path was what actually ran. HOME_TASK_6 built that concept (`entry=bag|card` → `context_data.entryCoffeeId`/`entryMethod` → `assembleSystemPrompt()`'s new `currentCoffeeContext` param) and wired it in — see S79 for the full mechanism. The historical note above is left in place rather than deleted, so the "why the omit path existed" reasoning stays legible.

**6. Model policy (§4.7).** A detected knowledge topic routes unconditionally to the expertise model (`config.modelRouting.expertiseModelOverride ?? 'claude-sonnet-4-6'`) — the existing keyword/word-count heuristic is bypassed entirely for expertise turns, not just weighted. `expertiseModelOverride` is a seeded `null` slot for a later manual A/B (e.g. Fable) against blind transcripts; matching mode's existing Haiku/Sonnet routing logic is byte-for-byte untouched.

**7. `sommelier.ts`'s `/message` handler** now calls `routeTopic()` before `chatWithSommelier()`, passes the resulting `mode`, and persists `currentTopic`, `currentTopicTurnsSinceMatch`, and an appended `topicLog` entry back into `sommelier_sessions.context_data` on every turn — this is a genuinely new persistence path; before this task, `context_data` was written once at session start and never updated again. `/start` (the opening turn) doesn't route a topic — there's no user message yet, so `chatWithSommelier()` defaults to matching mode there, same as always.

**Config pushed live via the config-drift/config-apply mechanism (Task 1), not a one-off script**: 22 new paths (`topics.*`, `topicRouter.*`, `responseContracts.*`, `contextAssembly.omitCatalogInExpertiseMode`, `modelRouting.expertiseModelOverride`) — every one of them a brand-new key this task introduces, verified programmatically before applying that none of them touched an existing value. Applied via the identical dot-path-merge + `config/sommelier/audit/{autoId}` write the admin UI's Apply button performs; there was no interactive admin session available to click it directly, so this is the mechanism's own operation run directly rather than a bespoke script. Confirmed 0 remaining drift after.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment, per S70; live checks used the Cloud SQL Auth Proxy and a clearly-marked test uid, read back and deleted immediately after):
- `tsc --noEmit` clean.
- **The byte-for-byte check the task cared about most**: captured the exact pre-change assembly logic (`git show HEAD`) and diffed its output against the new `assembleSystemPrompt()` for a matching-mode turn — confirmed the only difference, in both a mid-session turn and the final-turn branch, is the deliberate Guardrails insertion (stripping exactly that block from the new output reproduces the old output character-for-character). No incidental reordering, whitespace, or text drift anywhere else in the matching-mode path.
- Expertise mode confirmed: catalog block absent, numbers carve-out present, guardrails present in both modes (since they're in the always-included base prompt).
- Topic router (against the real live config, all 22 keys freshly applied): a fresh keyword match → `brewing`/expertise; a pronoun follow-up ("and what about that?") → sticky carry, same topic; a second ambiguous turn → still sticky (decay not yet reached); a third ambiguous turn → topic clears to `null`/matching, exactly matching the seeded `stickyDecayTurns: 2`. A cold ambiguous message with no session history → `null`/matching immediately.
- Persistence: inserted a marked test `sommelier_sessions` row (`_home_task2_verify_test_uid`), ran the same 4-turn sequence through the real `/message`-handler persistence logic, read back `context_data.topicLog` (4 entries, correct turn/topic/confidence/sticky fields) and `currentTopic` (correctly `null` after decay), closed the session, confirmed the topic log survives close, then deleted the test row — table has no FK on `uid`, so this required no real Firebase account.

**Not verified this pass, same disclosure pattern as S51**: "read 10 dev transcripts against the voice rules" — there's no real customer traffic yet that could have hit expertise mode (this hasn't shipped to users), so there's nothing to read. Flagging this here rather than silently skipping it; do this once the first real expertise-mode conversations exist.

**Nothing else touched, per the task's explicit scope**: no token/meter changes, no memory markers, no story content, no new intents, no changes to intent selection/priority/the six-intent evaluator, no frontend changes.

---

### HOME Task 3 — Meter Retirement & the Invisible Guard Layer (§5, §4.8) (2026-07-30)

#### S72. Token meter retired customer-facing; gating goes config-driven and defaults off; the invisible guard layer lands

**Context**: `HOME_TASK_3_METER_RETIREMENT_GUARDS.md`. Liam is inside the subscription (decided 2026-07-27, §5) — no customer ever sees a balance, a cost, or "buy tokens" again. The accounting schema (`user_tokens`/`token_events`) stays exactly as it is; only what customers see and what gates a turn changes. The operator-facing guard layer (§4.8) replaces the meter as the thing that actually bounds usage.

**1. `tokenEconomy.gatingEnabled`** (new config flag, seed default `false`): `false` — `/start` doesn't block on balance, `/message` doesn't call `spendToken` as a gate; both write a `usage_log` `token_events` row instead (delta 0, no balance mutation, no rollback path — there's nothing to roll back since nothing was spent). `true` — exactly today's pre-this-task behavior, kept as a rollback lever. Signup/order bonus grants keep running either way (harmless, preserves the schema's meaning per the task spec).

**2. `tokenService.ts` gained exactly one new export, nothing else touched**: `logUsage(uid, referenceId, model)` — reads the current balance (unmutated) and inserts the `usage_log` row. `spendToken`/`grantTokens`/`getTokenBalance` are byte-for-byte unchanged; re-verified by exercising them directly in the gated-path test below.

**3. New `backend/src/services/sommelierGuards.ts`** — the guard layer itself, all thresholds config-driven with fallbacks matching the seed:
- `checkDailyCap(uid)` — counts `token_events` where `reason IN ('sommelier_turn', 'usage_log')` and `created_at` is today (chose the SQL-counter approach the task doc offered, over a Firestore message-doc count, specifically because both the gated and ungated turn paths already write exactly one such row per turn — one counter covers either state of `gatingEnabled`). Default cap 60/day.
- `getMonthlySpendEstimate(uid)` / `checkMonthlySpendAndAlert(uid)` — turns this calendar month × a configured $/model estimate (`config.guards.modelCostPerTurnUsd`, seeded as planning estimates, not real Anthropic billing figures), logged as a `console.warn` admin-visible flag the first time a user crosses `config.guards.monthlySpendCeilingUsd` (default $5) each day — an in-memory, per-instance, once-per-user-per-day throttle keeps this from spamming logs while someone sits over the ceiling.
- `checkAggregateAnomaly()` — today's total turns vs. the trailing 7-day average, flagged when today > `config.guards.anomalyMultiplier` (default 3×) the average. Aggregate, not per-user; computed on demand for the admin dashboard, not on every turn.

**4. `token_events` gained a nullable `model TEXT` column** (additive, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) — which model handled a turn, needed for the monthly-spend estimate to know which $/turn figure to apply. `NULL` for bonus rows and anything written before this column existed; `getMonthlySpendEstimate()` falls back to a representative cost rather than dropping a null-model row from the count.

**5. Rate limiting** — two new `express-rate-limit` instances in `sommelier.ts` (the package was already a dependency, used elsewhere in the codebase — `quiz.ts`'s funnel-event limiter, `index.ts`'s global limiter), applied to `/start` and `/message`: per-IP (`config.guards.rateLimits.perIpPerMinute`, default 30/min) and per-account (keyed on `req.uid`, default 15/min). Both read live config per request via a function-typed `limit` option, so thresholds are still a no-deploy tuning lever — but `windowMs` itself (fixed at 1 minute) and the limiter's internal counters are **per-instance**: Cloud Run runs multiple instances, so this is a per-instance limit, not a global one, exactly as the task spec anticipated ("acceptable at this scale... say so in the build log"). A shared store (Redis) would be the upgrade if that tolerance ever stops holding.

**6. The daily-cap close is a fixed line, not a model call** — per S33's "hard rules belong in code, not the prompt": `DAILY_CAP_CLOSE_MESSAGE` in `sommelier.ts` ("That's a good amount of ground for today — let's pick this back up tomorrow."), checked before generating a reply so a capped-out turn never reaches the model. The user's message is still saved (they did send it), Liam's fixed line is saved as the reply, and the session closes with `close_reason: 'daily_cap'` — the same shape a normal turn-limit close already has, not a bare error.

**7. Admin dashboard additions on `GET /api/admin/sommelier/stats`** (`admin.ts`) and `AdminSommelierFlow.tsx`: today's turns, a 7-day trend (simple bar sparkline), top-10 users by turns this month with an estimated-spend figure and an over-ceiling flag, daily-cap hit count (from `sommelier_sessions.close_reason = 'daily_cap'`), and the aggregate anomaly flag. Admin-only surface — none of this is customer-facing.

**8. `Sommelier.tsx` — the customer-facing meter is gone.** Removed: the sidebar token balance, the "Buy tokens" button, the status-row token count, the zero-balance "get more tokens" block, the initial `GET /api/tokens/balance` fetch, and the `purchaseEnabled` config fetch that only existed to drive the Buy-tokens button. The turn counter (`X/N`) stays — it's a session shape, not a price, per the task's explicit instruction. `402`/`429` responses (only reachable if `gatingEnabled` is ever flipped back to `true`, or the invisible daily cap) now degrade to a generic "Something went wrong" state rather than surfacing any token/limit language — the customer never learns a mechanism was involved. Fixed, as a side effect of this pass: the pre-existing placeholder-text bug where `inputDisabled` (previously true during `sending` too) showed "No tokens remaining" while a normal reply was in flight — now shows the ordinary placeholder unless the session is actually closed.

**The S44-style grep** (the verification Dana cared about most): `grep -rn 'tokenBalance\|token_events\|user_tokens\|tokenEconomy\|costPerTurn\|Buy tokens\|purchaseEnabled' frontend/src` — 3 files matched: `Sommelier.tsx` (fixed, above), and `AdminSommelierConfig.tsx`/`AdminSommelierFlow.tsx` (admin-only pages — legitimately out of scope; admins are the ones who'd flip `gatingEnabled` back on as a rollback, and the flow dashboard's existing token stats are operator-facing, not customer-facing). Broadened the grep to plain `token`/`balance` (case-insensitive) across all of `frontend/src` to catch anything the first pass might have missed, per the S44 lesson — every other hit was unrelated (`getIdToken()` calls, a `QuoteToken`/`CinToken` text-splitting type in `Home.tsx`, visual/flavor "balance" language on marketing pages). **Confirmed: `Sommelier.tsx` was the only customer-facing surface, and it no longer renders anything token-related.**

**Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 8 new paths (`tokenEconomy.gatingEnabled`, `guards.*`) — every one confirmed new before applying (none touched an existing value), applied via the same dot-path-merge + audit-doc write the admin UI's Apply button performs. 0 remaining drift after.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment, per S70; the live `gatingEnabled` flip was confirmed safe with Dana first — no deployed Cloud Run instance was serving real traffic during this pass — and the final state, `false`, was Dana's explicit choice, not assumed):
- `tsc --noEmit` clean.
- `ALTER TABLE token_events ADD COLUMN IF NOT EXISTS model TEXT` applied directly against prod (this normally runs automatically via `schema.sql` at boot; applied here ahead of a deploy so the verification below had the column to write to).
- Created a marked test user (`_home_task3_verify_test_uid`, real `user_profile`/`user_tokens` rows since `user_tokens.uid` FKs to `user_profile.firebase_uid` — `sommelier_sessions.uid` has no such FK, unlike Task 2's test). With `gatingEnabled=false`: the zero-balance test user "chatted" via `logUsage()` for two turns — `token_events` showed two `usage_log` rows (`delta=0`), balance stayed exactly 0, and `checkDailyCap` counted both correctly.
- Flipped `gatingEnabled` to `true` live: `spendToken` at balance 0 correctly returned `success: false` (today's pre-task gating restored); granted 5 tokens and spent again — `success: true, newBalance: 4`, confirming the unchanged `spendToken`/`grantTokens` internals still work correctly. Flipped back to `false` immediately after — confirmed live and via `onSnapshot`.
- Forced `guards.dailyTurnCap` to 3 live: with 3 turns already logged today, `checkDailyCap` correctly reported `hit: true`. Manually inserted a `token_events` row dated yesterday for the same user and confirmed the count was unaffected — the day-boundary query correctly excludes it, so "a new session next day works" is a property of the query, not something that needed separate proving. Restored `dailyTurnCap` to 60 live, confirmed.
- Full cleanup: all test `token_events`/`user_tokens`/`user_profile` rows deleted; live config ended exactly where Dana specified (`gatingEnabled: false`, `dailyTurnCap: 60`).

**E5 coupling — TODO, not touched this pass** (per the task's explicit instruction — `launch/40_email-marketing` untouched): the welcome-journey email E5 currently promises founding members an "expanded token allowance for Liam." **This line needs to be reworded to the full-sommelier-access framing** ("Liam is included, unlimited" — not a bigger meter) before E5 ships, since the meter it references no longer exists. Queued for whoever owns the email workstream; flagged here per the strategy doc's own §5 note ("one coupling to fix in the same breath") and this task's explicit scope boundary.

**Out of scope, per the task spec, untouched**: no schema drops (`user_tokens`/`token_events` both stay); `tokenService.ts`'s existing internals (`spendToken`/`grantTokens`/`getTokenBalance`) beyond the new `logUsage` export; no router/prompt changes (Task 2's territory); the tokens API routes (`GET /api/tokens/balance`, `POST /api/tokens/purchase`) still exist, admin-reachable, just nothing customer-facing calls them anymore.

---

### HOME Task 4 — Memory & the Brew Profile (§4.5, §3.5) (2026-07-31)

#### S73. `<<remember:...>>` markers, the brew-profile whitelist, and the five write rules — the `taste_journey` incident (S49) made these non-negotiable

**Context**: `HOME_TASK_4_MEMORY_BREW_PROFILE.md`. Liam learns durable facts about a customer's setup and habits mid-conversation and remembers them permanently — the first piece of `home_v3`'s memory layer (§4.5). Every rule in this task exists because S49's silent, year-long `taste_journey` write failure is exactly what happens without them.

**1. Marker grammar, extending S51's pattern.** `<<remember:field=value>>` — same "never trust the model" discipline as `<<action:...>>`: `chatWithSommelier()` (`claude.ts`) only *parses* the raw field/value text and strips the marker from the visible reply; a new `resolveRemember()` (`sommelier.ts`, exported for testability like `assembleSystemPrompt()`) is what validates against the whitelist and actually writes. `LIAM_BASE_PROMPT` gained a "Remembering facts" section (S32-style: Good/Bad examples) directly after Action markers — confirm in-voice in the same reply, then the marker; at most one per turn; never an inference, only what the customer actually said.

**2. Field whitelist — Phase 1 set**, in `config/sommelier.brewProfile.fields`: `brew_methods` (array, 8 values incl. `other`, capped at 8 items), `grinder` (enum, 5 values), `takes_it` (enum, 4 values), `decaf_constraint` (bool), `aversions` (array_freeform, capped at 10 items × 40 chars). Every field here changes a sentence Liam can say (§3.5's own rule) — the culture/background/timing fields from the full self-serve list are Task 10's, not this task's. Validation lives in one place, `backend/src/services/brewProfile.ts`'s `validateSingleValue()`, shared by both the conversation path and the profile-page mirror so the whitelist can never drift between the two writers.

**3. Storage shape** — `users/{uid}/metadata/brew_profile` (4 segments, S22/S49's rule): each field is its own object, `{ value, source: 'conversation' | 'profile_page', capturedAt }`, not a flat value — this is what makes per-field staleness (rule 5) and per-field provenance possible. Conversation writes to array-type fields (`brew_methods`, `aversions`) **append and dedup** (a fact mentioned across multiple turns/sessions accumulates); profile-page edits **replace** the full array (the customer is stating their complete current answer, not adding one item) — deliberately different semantics for deliberately different capture modes, both funneling through the same whitelist validator.

**4. The five write rules, and exactly where each lives:**
1. **In-voice confirmation before saving** — the prompt rule itself (S1 above); there's no code enforcement possible for this one, it's a voice discipline.
2. **Mirror from day one** — `GET/PATCH/DELETE /api/users/brew-profile` (`users.ts`) + `BrewProfileMirror.tsx` (new, under `frontend/.../profile/`), added to the Profile page's Flavor Memory area. Shows captured fields only (per §3.5, the full self-serve add-a-field section is Task 10) — read, edit (replace), delete. **Delete removes the field key via `FieldValue.delete()`, never a null-write** — a null value would still read as "captured, unknown" to the summary formatter; removal reads as "nothing captured," which is what the customer actually asked for.
3. **Logged writes, never silent** — every write attempt, success or failure, from *either* writer (conversation marker or profile-page edit), increments `admin_stats/brew_profile.writes` or `.failures` (`incrementBrewProfileCounter()`), surfaced on `GET /api/admin/sommelier/stats` → `brewProfileStats` and a new row on `AdminSommelierFlow.tsx`. An invalid field or value is dropped and logged (`console.warn`), never silently swallowed and never a 500 to the customer.
4. **End-to-end verification against production before launch** — see Verified, below; this is the one rule that's entirely about *this task's own process*, not a runtime behavior.
5. **Stale re-confirm** — `config.brewProfile.staleAfterDays` (seed default 120). `getStaleFieldNudge()` (`brewProfile.ts`) checks the *current turn's topic* (HOME_TASK_2's router) against a small topic→field relevance map (`brewing`→`brew_methods`, `equipment`→`grinder`, `caffeine_decaf`→`decaf_constraint`, `my_coffee`→`takes_it`) and only nudges when the stale field is actually relevant to what's being discussed. **At most one per session**, tracked via a new `context_data.staleNudgeSent` boolean that latches `true` the first time and never resets within the session.

**5. Injection — through S71's `assembleSystemPrompt()`, both modes**, exactly as the environment note specified. A new optional `brewProfileContext` param, appended as its own line ("What you know about their setup: …") right after the opening-context block, **every turn** (not just the opening one, unlike `openingContext` — a fact learned mid-conversation needs to inform every subsequent turn in that same conversation, not just turn 0). The brew profile itself is read live from Firestore every turn in `sommelier.ts` (a new `getBrewProfile()` helper, also exported) rather than cached in `context_data` like `catalogText` — deliberately different from the RAG catalog's "assembly-time only" rule, because a fact captured one turn ago in *this same* conversation must show up on the very next turn, which a session-start cache would miss.

**6. Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 12 new paths under `brewProfile.*`, every one confirmed new before applying, 0 remaining drift after.

**A real bug, found by the task's own required verification, not hypothetical**: the live model (Haiku) emitted `<<remember:brew_method=v60>>` — **singular** — against the plural whitelist key `brew_methods`, on the very first real API call made against this prompt. Exactly the near-miss write rule 3 exists to catch: it was dropped, logged, and counted correctly, with zero impact on the customer's reply. Fixed at two levels rather than left as a "well, it degrades gracefully": (a) the prompt now explicitly spells out all five valid field names verbatim in the Remembering-facts section — re-tested with a fresh live call immediately after, which then emitted the correct plural field name; (b) a small `normalizeFieldName()` alias map (`brew_method`→`brew_methods`, `aversion`→`aversions`) in `brewProfile.ts` as defense-in-depth, verified independently via a direct `resolveRemember()` call with the exact singular variant Haiku produced. Both fixes are additive to this task's own new mechanism, not a change to any pre-existing behavior.

**Verified** (no separate dev Firestore — `axis-and-bloom-prod` is the only environment, per S70; this task is Firestore-only, no Postgres/Cloud SQL Auth Proxy needed at all):
- `tsc --noEmit` clean.
- **The byte-for-byte re-check the environment note asked for**: diffed the new `assembleSystemPrompt()`'s output (fixed fake session/config/catalog inputs, matching mode) against the exact pre-HOME_TASK_4 (HOME_TASK_2-era) assembly logic — with no brew profile, the new output's tail is identical to the old tail (confirmed via exact string equality on the appended portion); with a brew profile present, the new output equals the no-profile output plus exactly one new line, nothing else. Base-prompt wording changes this task made (the new Remembering-facts section, tightened for field-name precision after the bug above) are additive to a section this task itself introduces, not a change to any pre-existing section.
- **Write rule 1 & 4 together, against real production**: one real `chatWithSommelier()` call (Haiku) with the message "I brew with a V60 every morning" — the model confirmed in-voice ("V60 — noted…") and emitted the correct marker; `resolveRemember()` wrote it; **read back via the Admin SDK directly against the live document**, confirmed `brew_methods.value` contains `v60` with `source: 'conversation'`.
- **Write rule 3, forced failure** (the verification asked for specifically): called `resolveRemember()` directly with an invalid value (`grinder=unicorn_grinder`) and a wholly unknown field (`not_a_real_field=whatever`) — both dropped, neither written (confirmed via read-back), and `admin_stats/brew_profile.failures` incremented by exactly 2, read back via `getBrewProfileCounters()`.
- **Write rule 2, mirror round-trip**: simulated the PATCH (replace, `source: 'profile_page'`) and DELETE (field-removal-not-null-write) operations directly against the marked test doc — edit confirmed via read-back (`source` correctly `profile_page`), delete confirmed the key was entirely absent afterward (`'grinder' in data === false`), not present-with-null.
- **Write rule 5, stale re-confirm**: a synthetic profile with a 130-day-old `capturedAt` (staleAfterDays is 120) on `brew_methods` correctly produced a nudge on a `brewing`-topic turn; correctly produced no nudge when `alreadyNudged=true` (session cap), when the turn's topic didn't map to the stale field, and when the field was fresh.
- All test writes made against the one marked test doc (`_home_task4_verify_test_uid`) were deleted; the `admin_stats/brew_profile` counters were restored to their exact pre-test values (not deleted — a real operational counter, not test scaffolding) rather than left inflated by the verification run itself.

**Nothing else touched, per the task's explicit scope**: no fields beyond the Phase 1 whitelist (culture/background/timing are Task 10's); no brew cards (Task 6); no beats (Task 8); the six-intent evaluator, action-marker behavior, and topic router are all unchanged — this sits alongside them, not inside them.

---

### HOME Task 5 — The Story Layer (§4.4) (2026-07-31)

#### S74. Per-coffee story content, the specificity line enforced twice, a public story page — the data-level fix S38/S44 proved is the only kind that holds

**Context**: `HOME_TASK_5_STORY_LAYER.md`. "Their coffee, explained" — curated per-coffee story content Liam speaks from, replacing any temptation to inject raw `coffees.origin`/`process` columns directly. S38 was the leak one abstraction up (the catalog line, the generated-content call sites); this is the data-level fix at the origin-story layer specifically.

**1. The specificity line, enforced twice, exactly as spec'd.** (a) Generation prompt (`storyLayer.ts`, new — a dedicated, independent Anthropic client, **not** imported from `claude.ts`; per the task's explicit S38 constraint, `claude.ts`'s three existing content functions — and the file itself — are untouched by this task): region and process allowed, farm/co-op/cooperative/estate/lot/importer/roaster explicitly banned, with an explicit instruction to distill the raw `origin` column to region-level even when it contains more specific text. (b) Post-generation `checkStorySpecificityViolations()`: rejects if the output matches the coffee's own raw catalog name, any linked roaster name (`coffees.roaster` *and* every `roaster_blend`-linked roaster — a coffee can have more than one), or `config/sommelier.storyLayer.bannedTerms` (seeded: farm, co-op, coop, cooperative, estate, lot, importer, roaster, roastery — whole-word, case-insensitive). `generateCoffeeStoryWithRetry()` retries up to 2 additional times, feeding back exactly which check tripped so the retry has a real chance of correcting it, not just repeating the mistake.

**2. The S44 lesson, copied not reinvented.** `fetchCoffeeDataForContent()` (`coffees.ts`) was, itself, quietly using the *pre-S44* alias pattern (`coffee_alias.platform_name` only, no `dial_slot_alias` join) — the exact bug S44 fixed in `sommelierRag.ts`'s `getAliases()` but which this call site had never been audited against. Fixed by extracting a shared `resolveDisplayName()` (same query shape as `getAliases()`, adapted for a single coffee rather than a batch) and using it in both `fetchCoffeeDataForContent()` and the new public story endpoint. This wasn't optional scope creep — the story generator needed a *reliably current* display name exactly as much as Liam's catalog context does, and the task's own context section flagged this join by name ("copy that join, don't reinvent it").

**3. Storage** — `coffees` gained `story`, `story_draft`, `story_published`, `story_admin_edited`, `story_generated_at`. "Generate, scan, then mark live," literally: `story_draft` always holds the latest attempt (pass or fail, for admin visibility on a coffee that keeps failing); `story` — the only field anything customer-facing or Liam-facing ever reads — and `story_published` only advance when that attempt actually passed. `story_admin_edited` rows are skipped by every future bulk regenerate (`generateAndStoreAllContent`'s existing `force` flag now has one field it doesn't override).

**4. Admin** (`AdminCoffees.tsx` + `PATCH /api/admin/coffees/:id/story`): a small view/edit modal per coffee (existing "Refresh AI content" button now regenerates story too, since it already routes through `generateAndStoreAllContent`). Direct edits run the identical specificity check; a violation is a 409 with the reasons listed, not a silent save — an admin confident it's a false positive can pass `force: true`, which is logged (`console.warn`), not silent.

**5. Injection — through `assembleSystemPrompt()` (S71), exactly where the environment note asked for it.** New optional `storyContext` param; on an expertise-mode turn, if a story is available it's injected ("Their coffee, explained:\n...") **in the same branch that already omits the catalog** — replacing raw fields with story content is structurally "the catalog-omission branch gained an else," not a new code path. `sommelier.ts` decides *whether* to pass one (only on `my_coffee`/`origins_process` topics, S71's router), keeping `assembleSystemPrompt()` itself topic-agnostic and pure. The relevant coffee is whichever of the session's RAG-selected coffees (cached in `context_data.storyCandidates` at session start, same "no re-query" principle as `catalogText`) has a published story — there is deliberately no "current coffee" concept built here; S71 already deferred that stub pending brew cards (Task 6), and this task's injection is topic-triggered story content, not that stub. `LIAM_BASE_PROMPT` did not need a new guardrail sentence — Task 2's own origins guardrail ("speak only from what's actually in front of you — the catalog **and story content provided**") already anticipated this injection verbatim.

**6. Public story page** — `GET /api/coffees/:id/story` (public, roaster-blind, same discipline as `/:id/hops`) + `/coffee/:id/story` (`CoffeeStoryPage.tsx`, new). **Built as a small, dedicated page rather than extending `BloomPage.tsx`/`PositionCard.tsx`**, a deliberate deviation from the task's stated preference ("prefer extending the existing Bloom surface"): `PositionCard`/`RevealedPanel` carry cart, compare-overlay, and personalization state this public, possibly-signed-out surface has no use for — extending them risked introducing bugs into the main Bloom experience for a feature that needs none of that machinery. Reuses `ARCHETYPE_COLOR` and the site's editorial typography conventions rather than forking a new visual language. This is also — route shape only — Task 7's future non-owner and retired-coffee scan destination; the past-tense "this one's moved on" copy and hop-graph traversal for a retired coffee are explicitly Task 7's own work, not built here.

**7. Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 1 new path (`storyLayer.bannedTerms`), confirmed new before applying, 0 remaining drift after.

**Backfill — two real findings, not a clean first pass, both fixed before calling it done:**
- **Finding 1 (prompt quality, not a leak): every generated story included an unwanted Markdown `# Title` header**, and one story (Breakfast Blend) **invented a new name ("Soft & Smooth") instead of using the provided display name** — neither caught by the specificity check (neither is a raw-name/roaster/banned-term match), but both would have rendered wrong or read as inconsistent on the public page. Fixed at the prompt level (explicit "no title, no markdown, use only the given name, never invent one") plus a defensive strip of any leading heading line in `storyLayer.ts` — the same "enforce twice" philosophy applied to a formatting concern, not just the specificity line. All 25 coffees were regenerated against the corrected prompt (story field only — `ai_summary`/`surprise_note`/`three_voice_story` were left alone, already cached and fine, via a targeted regeneration rather than a wasteful full `force: true` on all four fields).
- **Finding 2 (the specificity check's own false positive): for single-origin coffees whose *raw internal catalog name* literally is the origin country** (`Ethiopia`, `Honduras`, `Guatemala`, `Sumatra`, `Uganda`, `Papua New Guinea`, `Costa Rica`, `Kenya` — an existing internal naming convention, not something this task introduced) **and for the Decaf category coffee** (raw name `Decaf`, which is also literally part of its own public alias, "Classic Decaf"), the raw-coffee-name check correctly-per-its-own-rule flagged the model's *legitimate, region-level* origin mention as a match against the raw name — because in this catalog, the raw name and the allowed content are the same string. Of these, all but 2 reworded around it within 1–3 retries; **coffee 13 (Decaf) and coffee 24 (Sumatra) exhausted all 3 retries** because the model, quite reasonably, kept using the exact origin term it was given as origin reference material. Both drafts were read in full (region-level only, no farm/co-op/lot/estate/importer/roaster anywhere in the text) and published via the admin `force: true` override — a deliberate, documented human-review call, not a loosening of the check itself (which stays exactly as strict for every other coffee, including any future roaster/proprietary-name leak). **Final state: 25/25 active-rotation coffees have a published story** (23 passed the automated check outright, 2 published via reviewed override).

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; content generation and the backfill ran directly against it, per the environment note's "generate, scan, THEN mark live" sequencing):
- `tsc --noEmit` clean.
- **The S38 spot-check, repeated, exactly as asked**: programmatically scanned every one of the 25 published stories against raw coffee name, every linked roaster name, and the banned-term list. **23 clean outright; 2 flagged** — precisely the two documented, deliberately-overridden false positives above, not a surprise. This is the scan working correctly, not a gap: a published-but-flagged story is exactly the state a reviewed override should leave behind, visible to any future audit rather than hidden.
- **Manually read considerably more than 5** across the investigation (the two rounds of backfill plus the final post-fix read) — the final pass alone re-read 5 fresh (coffees 1, 5, 17, 19, 20): no markdown headers, no invented names, region-level origin only (including two that name a specific *department/region* — Huehuetenango, Tolima — still region-level, not a farm/estate/lot), no roaster or raw-name leaks.
- **Double enforcement proof, both organically and by deliberate test**: the backfill itself produced 9+ real, organic rejections across both passes (Ethiopia, Honduras, Decaf ×3, Guatemala, Sumatra ×3, Uganda ×2, Papua New Guinea, Costa Rica, Kenya, Colombia — each logged with the exact violation caught) — the reject-and-retry path catching a genuine specificity-line violation is not hypothetical, it happened repeatedly during this task's own backfill. Additionally ran one hand-crafted, deliberately-violating string ("Finca El Paraiso estate," "our importer partner," "Northstar Roastery") directly through `checkStorySpecificityViolations()` — correctly caught all three distinct violation types (roaster name, and two separate banned terms) in one call.
- **Regenerate-after-edit**: coffee 13 (`story_admin_edited = true` from the override above) run through `generateAndStoreAllContent(13, { force: true })` — `story` came back byte-identical to before the call, confirmed both in the function's return value and by reading the row back from the database directly.
- **Injection assembly, both structurally and in a real conversation**: `assembleSystemPrompt()` with a real published story and `mode: 'expertise'` — the story text appears, the raw `catalogContext` does not; with no story, the existing Task 2 omit-branch baseline is unchanged; matching mode is unaffected by `storyContext`'s mere presence in the params object. Then one real `chatWithSommelier()` call — `routeTopic("Tell me about my coffee")` correctly classified `my_coffee`/expertise — with that story injected: Liam's reply drew specific, accurate detail from the story (region, process, tasting notes) and did not reference the fake catalog text it was deliberately *not* given in this mode.

**Nothing else touched, per the task's explicit scope**: `claude.ts`'s three existing content functions (and the file itself, beyond the new optional `assembleSystemPrompt`/`chatWithSommelier` params already covered above); no RAG query changes in `sommelierRag.ts`; no QR/redirect work (Task 7's own).

#### S75. `<<action:save_recipe>>` — Action Links extended to a user-initiated content save (Profile Part 7 Task 5, 2026-08-02)

**Context**: `backend/src/features/profile_page/CLAUDE_CODE_PROMPT_PROFILE_PART7_FLAVOR_MEMORY_ACTIVITY_LOG.md`. Profile's Flavor Memory tab became an activity log of deliberate moments (quiz/order/save/recipe); this is the Liam-facing half — letting a customer keep a brew recipe Liam just wrote for them, without giving Liam any new write path.

**The marker, one more time, same discipline as S51/S73.** `<<action:save_recipe>>` joins `retake_quiz`/`open_dial` in `LIAM_BASE_PROMPT`'s Action markers section (base prompt, not a per-intent addendum — a brew guide can come up on any intent, not one specific matching-flow moment). Fires only when the reply just written *is* the recipe/brew guide the customer asked for — never preemptively, never on a greeting. `chatWithSommelier()` (`claude.ts`) parses it into `actionTypes` and strips it from the visible reply exactly like the other two.

**Where this action genuinely differs from S51's two.** `retake_quiz`/`open_dial` are *links* — `resolveActions()` resolves a server-verified destination (a saved dial slot, in `open_dial`'s case) and the frontend renders a `<Link>`; clicking navigates, nothing is written. `save_recipe` carries no payload at all — `resolveActions()` just echoes `{ type: 'save_recipe' }` — because the actual write is a *separate, user-initiated action*: Liam only marks that offering a save makes sense; the customer has to tap a chip, and that tap calls a dedicated, validated endpoint (`POST /api/users/flavor-memory/liam-saves`) that never touches the model's output directly beyond the already-rendered message text the client sends back. This is the guardrail reconciliation the spec asked for stated in code: Action Links' original "no writes from chat" rule (S51) was about *identity and dial state* — archetype, dial position, anything Liam's own signal stack reads — and that rule is untouched; this is a new, narrower category (user-initiated *content* saves) that was never in scope for the original rule to forbid.

**Storage** — new Firestore subcollection `users/{uid}/liam_saves`: `{ kind: 'recipe', title, body, coffeeName: null, createdAt, removedAt? }`. `kind` is a one-value enum on purpose (brew tips/pairing notes could join later without a schema change). `title` is derived client-side in `Sommelier.tsx` from the tapped message's own first non-empty line, truncated — deliberately "dumb and predictable" per the spec, not a second model call; the server only length-validates (`title` ≤200 chars, `body` ≤4000) and stores verbatim. Removal is a tombstone (`removedAt`, `PATCH /api/users/flavor-memory/recipes/:docId/remove`), never a hard delete, same as the dial-events saves.

**Frontend chip** (`Sommelier.tsx`) — unlike the two Link-style chips, this one is a `<button>`: tap → POST → flips to "Saved ✓" + a second, then-appearing "View in your flavor memory →" link (`/profile?tab=memory`), matching the companion link `DialArchetypeSection.tsx`'s own "Saved ✓" gained in the same Profile Part 7 pass. Save status keyed by message index in local component state, not persisted across a reload of the chat (reloading a past session re-renders the chip in its unsaved state even for an already-saved recipe — accepted, not fixed: the recipe itself is durably saved either way, only the chip's own "already saved" indicator is session-local).

**Verified** with a real `chatWithSommelier()` conversation, not a synthetic marker string: asked Liam for a V60 recipe on a `my_coffee`-adjacent turn — real reply came back with exact ratio/temp/pour steps and the `<<action:save_recipe>>` marker attached; `resolveActions()` correctly produced `{ type: 'save_recipe' }` with no accompanying payload. Chip rendered, tap → `POST /api/users/flavor-memory/liam-saves` succeeded, chip flipped to Saved ✓ + View link, and the recipe appeared in the Profile activity log (see WHAT_WE_BUILT.md #127) as an expandable `Recipe` entry with the stored body intact. Confirmed a general greeting/exploratory turn does **not** produce the marker (no false positives observed in this pass). Test account and its Firestore data cleaned up after.

**Nothing else touched**: no new intents, no routing/token/turn changes, no change to `retake_quiz`/`open_dial`'s own resolution logic.

**Update (Profile Part 7B, same day, 2026-08-02) — superseded the title source above.** The marker is now `<<action:save_recipe:short title>>`: Liam supplies a 2-6 word title himself (he's the only party who actually knows what the recipe *is*), not a first-line extraction from his own reply. Parsed via one regex accepting both the bare and titled forms; a captured title is run through a new `sanitizeRecipeTitle()` (strips `<`/`>` and markdown emphasis, collapses whitespace, caps at 60 chars) before it ever reaches `resolveActions()` — same "never trust the LLM for ids" discipline, applied to display text this time. `SommelierAction`'s `save_recipe` variant gained an optional `title`; `Sommelier.tsx`'s `deriveRecipeTitle()` (the first-line extraction described above) is now the bare-marker fallback only, not the normal path. Verified with a real two-recipe conversation (V60 + cold brew, one session): Liam returned `"V60 for Cerro Azul"` and `"Cold brew overnight jar"` — both distinct, both meaningful, the first matching the spec's own example almost verbatim. Confirmed the marker instruction still lives only in `LIAM_BASE_PROMPT` (code) — no Firestore-seeded intent addendum carries a copy, so no admin-portal mirror edit was needed. See WHAT_WE_BUILT.md #128 for the full task breakdown.

---

### HOME Task 5b — FIX: Story Selection by Named Coffee + Memory-Confirm Integrity (2026-08-02)

#### S76. Two live defects, both real, both the S32-S34 refinement pattern working as designed

**Context**: `HOME_TASK_5B_FIX_STORY_SELECTION_MEMORY_CONFIRM.md`, found via browser-driven production verification the same day Tasks 1-5 (S70-S74) shipped. A fix task, tightly scoped, no new features — both defects are recorded here verbatim as the motivation, per the task's own instruction.

**Defect 1 (verbatim from the task doc)**: in a live session whose coffee strip included KENYA, "tell me about the kenya — where is it from and how is it processed?" returned *"Kenya's not in the catalog I'm working from right now."* The origins guardrail worked (no invention); story *selection* didn't — S74's injection picked "whichever `storyCandidate` has a published story," with nothing matching the story to the coffee the customer actually named.

**Defect 2 (verbatim from the task doc)**: "I usually brew with a french press at home, and I take my coffee with milk" produced "Good to know — French press with milk suits this earthy, dark-chocolate range well" — an in-voice acknowledgment of **both** facts — but S73's one-marker-per-turn cap only let `brew_methods=french_press` save. The customer heard "noted" about milk; Liam forgot it.

**Fix 1 — name-matching selection, in `sommelier.ts`.**
1. `context_data.storyCandidates` now carries `{ coffeeId, alias, story }` for **every** RAG-selected coffee, not just the ones with a published story (`story: null` for the rest) — a coffee has to be a legitimate match target even when it has no story to inject, which is a deliberately different state from "not a candidate at all." Alias comes from `sommelierRag.ts`'s existing `getAliases()` (now exported, not reinvented) — the identical S44-correct `dial_slot_alias`-with-`coffee_alias` join Liam's catalog text already uses.
2. New `resolveStoryForMessage(message, candidates)` (`sommelier.ts`, exported for testability like `resolveRemember()`/`assembleSystemPrompt()`): case-insensitive, whole-word regex match against each candidate's alias; longest alias wins on ties.
3. `/message`'s selection logic: named match with a story → inject it. Named match without one → no story at all — never substitutes a different candidate's content for the coffee actually asked about. No match → the pre-existing fallback (first candidate with a story, or none). Every turn on a `my_coffee`/`origins_process` topic logs `[storyLayer] turn selected coffeeId=... (named match|fallback)` — the coffeeId-logging the verification specifically asked for, so selection is provably deliberate, not coincidental.
4. `LIAM_BASE_PROMPT`'s Origins guardrail (S71) gained the never-say half: never assert a coffee is "not in the catalog," "isn't in my system," or similar absence-denial — a missing *detail* isn't a missing *coffee*. Good/Bad pair added using the exact live output as the Bad example, per house convention #8.

**A real, deeper finding surfaced while verifying this — flagged, not fixed here.** No alias anywhere in the catalog contains the word "Kenya" — the real coffee's actual alias is "Jammy & Aromatic" (its Bloom Dial slot name), and its published story deliberately says "Nyeri County" instead of the origin country, exactly per S74's own specificity check. The only way a customer could have typed "the kenya" is that `sommelier.ts`'s `coffeeNames` field (built in both `/start` and `/messages`, feeding the frontend's dotted coffee-strip line) selects `coffees.name` directly — the **raw internal name** — never resolved through the S44 alias join at all. This is a genuine, separate S38/S44 naming-discipline violation that predates this task. HOME_TASK_5b's own scope line ("No frontend changes") and its explicit two-defect list don't cover it, and per house convention #7 (scope discipline), it is **not** fixed in this pass — flagged here for a follow-up task, the same way S72 flagged the E5 email TODO. Practically: this task's alias-matching selection fix is exactly the right mechanism for when a customer names a coffee by its real, customer-safe alias (verified below); it doesn't yet help when the raw name leaks through the coffee strip, because today no alias contains that string to match against.

**Fix 2 — the marker cap, in `claude.ts` + config.** New `brewProfile.maxMarkersPerTurn` (seed default 2) in `DEFAULT_SOMMELIER_CONFIG`. `chatWithSommelier()`'s marker-collection loop now caps how many parsed `<<remember:...>>` markers are pushed into `rememberOps` at this value — every marker is still stripped from the visible reply regardless of count (a model that ignores the cap never leaks a stray token), only *collection* is bounded. `resolveRemember()` (`sommelier.ts`) needed no change: it already validated and wrote each op independently, incrementing the failure counter per-op — the cap-of-one was purely a caller-side (prompt + collection-loop) constraint, not a `resolveRemember()` limitation. Prompt: raised to "up to two markers... one per distinct fact," with a Good/Bad pair using the exact live example, plus (added during verification, below) a second Bad pair for the "confirms three, marks two" failure mode and a third for a malformed comma-joined single-marker value.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy + Admin SDK, marked test data, full cleanup):
- `tsc --noEmit` clean.
- **Kenya repro, coffeeId logged**: built a real 3-candidate `storyCandidates` set (coffeeId 31/Kenya + 2 others, all with published stories, so a match landing on 31 rules out first-candidate-fallback coincidence). Message naming the coffee by its real alias ("tell me about the jammy & aromatic one...") → `resolveStoryForMessage` resolved coffeeId 31, logged, and a real `chatWithSommelier()` call (Sonnet, expertise mode) replied with Kenya's actual story detail (Nyeri County, washed process, floral/lemon/orange) — correctly said "the highlands of Kenya" as a general-knowledge geography aside, not a leaked internal identifier (Kenya is the region here, same as "Ethiopia"/"Guatemala" elsewhere in the catalog). The literal live-repro wording ("tell me about the kenya...") was also run against the same real candidates for full transparency: no alias match (expected, per the finding above), correctly fell back to the first candidate with a story, and Liam's reply used the new guardrail phrasing exactly as intended — offered what it did have, no "not in the catalog" language (`deniesAbsence` check: false).
- **`resolveStoryForMessage` unit checks**, all passing: exact alias, case variant, longest-match tie ("classic decaf" over "decaf" when both present), no-match, and match-without-a-published-story (resolves the candidate, `story: null`, distinct from no-match).
- **Two-fact round-trip, the exact live sentence**: `chatWithSommelier()` → both `<<remember:brew_methods=french_press>>` and `<<remember:takes_it=milk>>` parsed (cap respected at exactly 2), reply confirmed both in one line ("French press with milk — noted."), `resolveRemember()` wrote both, **read back via the Admin SDK**: `brew_methods.value` contains `french_press`, `takes_it.value` is `milk`.
- **Mixed-validity**: one valid (`takes_it=sugar`) + one invalid (`grinder=unicorn_grinder`) in the same `resolveRemember()` call → valid written, invalid dropped, `admin_stats/brew_profile.failures` incremented by exactly 1, no exception.
- **Matching-mode byte-diff**: mechanical line-diff (not a visual read) of `LIAM_BASE_PROMPT` old vs new confirmed the only changes are the Origins guardrail and Remembering-facts edits — nothing else in the base prompt moved.
- **Three-fact message, a real and only partially-resolved finding**: ran three independent, non-conflicting facts in one fresh turn, across three different customer phrasings and three rounds of S32-style prompt tightening (each with a genuine, freshly-observed Bad example fed back in). The 2-marker cap held reliably every time (never more than 2 ops collected) — but the "don't verbally note the unmarked third fact" instruction was **not** reliably followed: Liam's reply consistently folded the third fact into the same confirming sentence ("Aeropress with sugar — got it. Nothing cinnamon-forward." / "Burr grinder, decaf, and no hazelnut — got it.") despite three consecutive, increasingly explicit rewrites. This is recorded honestly as a **demonstrated, unresolved voice-discipline gap** for the 3-plus-fact case specifically — write rule 1 was always documented (S73) as having no code-enforcement point, and this is that same limit showing up under load. No data-integrity issue results (the cap still holds; only 2 fields are ever actually written), and the two-fact case Dana asked about most directly works perfectly and consistently. Flagged for a future refinement pass rather than an unbounded prompt-tuning loop against a probabilistic target.
- **Config**: `brewProfile.maxMarkersPerTurn` — confirmed exactly 1 new path pre-apply, applied via the config-drift/config-apply mechanism (no interactive admin session available, so the mechanism's own dot-path-merge + `config/sommelier/audit/{autoId}` write was run directly, same as S71/S72/S74), 0 remaining drift after.

**Nothing else touched, per the task's explicit scope**: no Task 6 work (brew cards, entry params, current-coffee concept); no new whitelist fields; no changes to topic routing, intents, or guards; no changes to the story generation/scan pipeline; no frontend changes (the coffee-strip finding above is flagged, not fixed, for exactly this reason).

---

### HOME Task 5c — FIX: Coffee-Strip Raw-Name Leak (2026-08-02)

#### S77. The last known customer-facing `coffees.name` read, fixed — closes the S38/S44/S76 loop

**Context**: `HOME_TASK_5C_COFFEE_STRIP_ALIAS_LEAK.md`, flagged verbatim in S76 while fixing HOME_TASK_5b: `sommelier.ts`'s `coffeeNames` field — built in both `POST /start` and `GET /:sessionId/messages`, rendered by `Sommelier.tsx` as the dotted coffee-strip line above the first message — selected `coffees.name` directly, the raw internal name (e.g. "Kenya"), the same violation class S38 fixed in `buildCatalogText()` and S44 fixed in `getAliases()` itself. This is also what caused S76's Defect 1 indirectly: the UI was teaching customers a name Liam is forbidden to know, so naming the coffee that way could never hit S76's new name-matching path.

**Fix — one new shared helper, both call sites switched to it.** `resolveCoffeeDisplayNames(coffeeIds)` (new, `sommelier.ts`, placed beside `resolveStoryForMessage()`): resolves through `sommelierRag.ts`'s exported `getAliases()` — the S44-correct `dial_slot_alias`-with-`coffee_alias.platform_name`-fallback join, not reinvented — then falls back to the coffee's archetype label (fetched via one small `archetype_assignments` join, formatted exactly like `buildCatalogText()`'s own `archetypeLabel` derivation) for any coffee with no alias at all, never the raw name. Both `/start`'s `coffeeNames` (built from `ragResult.coffeeIds`, freshly selected at session start) and `GET /:sessionId/messages`'s `coffeeNames` (built from the session's stored `context_data.coffeeIds`) now call this same function. No third `coffeeNames` build site exists (grepped, confirmed). Historical sessions need no data migration — names resolve at read time, so a session created before this fix heals itself the next time its strip is rendered, exactly like S74/S76's own read-time-resolution pattern.

**The repo-wide S44 grep audit, per house convention #2** — every read of `coffees.name`/`c.name` across `backend/src`, verdicted:

| Site | File | Verdict |
|---|---|---|
| `coffeeNames` in `POST /start` | `sommelier.ts` | **Fixed here** — now `resolveCoffeeDisplayNames()` |
| `coffeeNames` in `GET /:sessionId/messages` | `sommelier.ts` | **Fixed here** — now `resolveCoffeeDisplayNames()` |
| `CoffeeRow.name` in `BASE_COFFEE_SQL` + all 5 duplicated RAG-focus queries | `sommelierRag.ts` | Already alias-correct — `name` is selected into the row but `buildCatalogText()` (S38) never prints it, and `RagResult` only exposes `catalogText`/`coffeeIds`; the field is fetched and unused, never reaches a customer response |
| `fetchCoffeeDataForContent()`'s `c.name` | `coffees.ts:62` | Already alias-correct — only passed as `rawCoffeeName` into `generateCoffeeStoryWithRetry()`'s specificity *check* (a comparison target, never rendered); the actual customer-facing `coffeeName` param uses `safeName` (`data.displayName ?? archetypeLabel`), per S38 |
| `GET /api/coffees` (bare list) | `coffees.ts:283-298` | **Genuine finding, flagged not fixed** — fully public (no auth on this router), selects `c.name`/`c.roaster` and returns them directly via `res.json(result.rows)`. Confirmed unreferenced by the current frontend (grepped `frontend/src` for a bare `/api/coffees` fetch — no caller), but still reachable by direct HTTP request. Out of scope for this task (fix section names `sommelier.ts`'s `coffeeNames` only) — flagged for a follow-up, same treatment S76 gave this exact finding one task ago |
| `GET /api/coffees/other-categories` | `coffees.ts:573-624` | **Genuine finding, flagged not fixed** — public, roaster-blind by design (`displayName: info.platform_name ?? info.coffee_name`), alias-preferred, but the fallback is the raw name, not the archetype label, if a category coffee (Decaf/Half-Caf/Flavored/Experimental) ever has no active `coffee_alias` row. Currently benign — S44 confirmed all 6 category coffees carry an alias — but an unguarded fallback path, not this task's fix target |
| `dialSuggestion.ts`'s `conflicting_coffee` (`otherCoffeeResult.rows[0]?.name`) | `dialSuggestion.ts:118-120` | Admin-only — sole caller is `GET /api/admin/sommelier/stats`'s `getDialSuggestion()` via `admin.ts:219`, and all of `admin.ts` sits behind `router.use(requireAdmin)` (`admin.ts:15`) |
| `c.name`/`coffee_name` reads (8 sites: alias admin CRUD, inventory, dial-position admin, hop-conflict scoring, roaster-blend admin) | `admin.ts:194,547,628,1026,1343,1408,2190,2228` | Admin-only — same `router.use(requireAdmin)` gate |
| `c.name`/`coffee_name` in `resolveBlendForSlot()`'s `ResolvedBlend`/`SkippedCandidate` | `blendResolver.ts:43` | Already alias-correct at the boundary — fetched into memory for internal fulfillment logic, but grepped every consumer (`coffees.ts`'s `buildSlotsForArchetype`, the sole caller for public routes): only `resolved.coffee_id` is read into the JSON response, never `.coffee_name`/`.roaster`; `SkippedCandidate`/`.skipped` is never read anywhere at all (dead field) |
| `FROM coffees`/`JOIN coffees` in `admin.lookups.test.ts` | `admin.lookups.test.ts` | Test file, not a runtime path — N/A |

Zero unexplained raw-name reads remain on a customer-facing path — the two genuine findings above are pre-existing, out-of-scope-for-this-task leaks (a different mechanism each, neither touching `sommelier.ts` or the RAG/story layer), flagged the same way S76 flagged this exact coffee-strip issue one task prior.

**No frontend changes** — confirmed, not assumed: `Sommelier.tsx` reads `coffeeNames` off the API response and joins it with `·` (`Sommelier.tsx:527`); it has no knowledge of where the strings came from.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy + a live backend instance pointed at prod, marked test data, full cleanup):
- `tsc --noEmit` clean.
- **Historical-session healing, proven against a real pre-fix session, not a fabricated one**: queried prod directly for a `sommelier_sessions` row containing coffee 31 (Kenya) predating this fix — session 16, started 2026-07-31. Confirmed coffee 31's raw name (`Kenya`) vs. its resolved alias (`Jammy & Aromatic`) directly via SQL. Minted a real Firebase ID token for that session's own uid (Admin SDK custom-token exchange) and called the live `GET /api/sommelier/:sessionId/messages` endpoint for sessions 16/17/19/22/24 (all pre-dating this fix): every one now returns `coffeeNames` including `"Jammy & Aromatic"` for coffee 31, never `"Kenya"` — no data migration involved, pure read-time resolution.
- **New session, real browser**: signed up a throwaway account, started a fresh Liam session (`?entry=user_initiated`) — the coffee strip rendered `CLASSIC BALANCED · CLEAN FRUIT · GROUNDED & EARTHY · LAYERED BOUQUET · QUIETA NON MOVERE · THE UNEXPECTED` — every entry a slot alias or (for the one archetype-less/no-alias case) an archetype-label fallback, zero raw names. Screenshot taken. Reloaded and used the app's own "Resume conversation" flow (exercises `GET /:sessionId/messages` on this same, now-historical session) — identical alias strip rendered, confirming both endpoints agree.
- **The named-match loop closes, per the task's own success criterion**: sent "Tell me about the jammy & aromatic one — where is it from?" into a session whose stored `storyCandidates` already carried the full S76 alias-tagged shape. Backend logged `[storyLayer] turn selected coffeeId=31 (named match) for session=24`, and Liam's reply correctly drew on Kenya's actual story ("Nyeri County, Kenya — high altitude, cool mornings, volcanic soil"). This is the mechanism S76 built but couldn't fully exercise, now actually reachable because the strip shows the alias the customer can type back.
- Test account (Firebase Auth + Firestore `users/{uid}` tree, including the `sommelier_sessions/{id}/messages` subcollections + `sommelier_evaluations`/`metadata` + `liam_saves`, and Cloud SQL `sommelier_sessions`/`token_events`/`user_tokens`/`user_profile` rows) fully deleted after verification; confirmed zero remaining.

**Out of scope, unchanged, per the task's own list**: no story/selection-logic changes (S76's, already working); no RAG query changes beyond the name resolution itself; no alias data edits; no Task 6 work; the two flagged-not-fixed findings above (`GET /api/coffees`, `GET /api/coffees/other-categories`'s raw-name fallback).

---

### HOME Task 5d — FIX: Public API Raw-Name Exposure (2026-08-02)

#### S78. Closes both findings S77 flagged: one removed, one formally accepted

**Context**: `HOME_TASK_5D_PUBLIC_API_RAW_NAMES.md`, the direct follow-up to S77's repo-wide grep audit. Two findings, two different dispositions.

**Finding A — `GET /api/coffees` (bare list, public, unauthenticated) — removed.** Confirmed genuinely dead before touching anything, not assumed: grepped `frontend/src` for any bare `fetch('/api/coffees')` (none — every frontend call is scoped to a sub-path like `/archetypes`, `/:id/content`, etc.), checked `frontend/public/match/*/index.html` (the static share pages) for any `<script>`/fetch (none — pure static HTML, no JS), checked `backend/scripts/` (no hits), and checked `coffees.test.ts` (mounts the router but has zero test coverage on the bare `GET /` route). The one place that *claimed* it was live — `WHAT_WE_BUILT.md`'s own route table, "kept for admin tooling, not called by any public page" — was itself stale: grepped every `frontend/src/app/components/admin/*` file for the same bare fetch, also zero hits. Per the task's stated preference and the environment note ("dead public surface is risk with no benefit"), removed the route entirely from `coffees.ts` rather than rebuilding it alias-only — nothing depends on it, so there's no alias-safe version worth maintaining. The stale "kept for admin tooling" line in `WHAT_WE_BUILT.md`'s route table was also corrected in the same pass (see WHAT_WE_BUILT.md #131) — leaving a documented-as-live entry for a route that no longer exists would just reseed the next audit's confusion.

**Finding B — `GET /api/coffees/other-categories`'s raw-name fallback — accepted, documented, not touched.** `displayName: info.platform_name ?? info.coffee_name` — for the 6 category-tagged coffees (Decaf/Half-Caf/Flavored/Experimental), this is the deliberate S44 fallback rule, not a violation: these coffees have no dial slot to inherit a slot alias from (see S44's own reasoning), so their own `coffee_alias.platform_name` — or, for the small number with no alias row at all, their raw catalog name — genuinely *is* their customer identity ("Decaf" is not a leaked internal codename, it's the product name). Recording explicitly here, per the task's own instruction, so this doesn't get re-flagged as a fresh finding by a future audit that doesn't know the S44 precedent: **this fallback is accepted as designed.**

**The routes-audit table**, per the task's own most-important verification ask — every unauthenticated route in `routes/coffees.ts` and `routes/axis.ts` (confirmed both files have zero `requireAuth`/`requireAdmin` anywhere — every route in both is public by construction), verdicted:

**`routes/coffees.ts`** (all public, no auth middleware in the file):

| Route | Verdict |
|---|---|
| `GET /` | **Removed this task** — previously raw `c.name`/`c.roaster`, confirmed dead (Finding A) |
| `GET /archetypes` | Alias-safe — `platformName` sourced only from the `dial_slot_alias`/`coffee_alias` join (`getAliases()`'s sibling logic in `buildSlotsForArchetype()`) |
| `GET /experimental` | Alias-safe — same `buildSlotsForArchetype()` as `/archetypes` |
| `GET /archetype-order` | No coffee identity in the response at all — archetype-level ordering only |
| `GET /other-categories` | Alias-preferred, raw-name fallback for a category coffee with no active alias — **accepted as designed** (Finding B, this task) |
| `GET /archetype-stats` | No coffee identity — archetype-level dimension aggregate only |
| `GET /:id/legacy-slot` | No coffee identity — resolves to `{archetype, dialSortOrder}` only |
| `GET /:coffeeId/hops` | Alias-safe — target's identity is `dial_slot_alias.platform_name` only, own header comment states "never includes to_coffee's id, name, or roaster" |
| `GET /:id/flavor-wheel` | No coffee identity — descriptor/wheel-category data only (`coffee_name` explicitly dropped from this query per an earlier Bloom Part 1 fix, per the file's own comment) |
| `GET /:id/dimensions` | No coffee identity — numeric dimension ranges + cupping notes only |
| `GET /:id/content` | Alias-safe — `aiSummary`/`surpriseNote`/`threeVoiceStory` generated from `safeName` (S38's fix), no raw `name` field anywhere in the response shape |
| `GET /:id/story` | Alias-safe — `displayName` via `resolveDisplayName()` with archetype-label fallback (S74), never raw name |
| `GET /:id/ai-summary` | Alias-safe — same `safeName` generation discipline as `/content` (legacy alias of the same underlying function) |

**`routes/axis.ts`** (all public, no auth middleware in the file, and no `coffees` table read at all):

| Route | Verdict |
|---|---|
| `GET /vectors` | No coffee identity — archetype-level dimension vectors only |
| `GET /adjacency` | No coffee identity — archetype-pair adjacency only, from `v_archetype_adjacency` |
| `GET /stats` | No coffee identity by explicit design — the file's own header comment states "aggregates and timestamps ONLY — no coffee IDs/names... must never leak enough to reconstruct positions or scoring" |

Zero unexplained raw-name/roaster exposure remains on any unauthenticated route in either file — one genuine finding fixed by removal, one formally accepted with its reasoning on record.

**Verified**: `tsc --noEmit` clean. Local backend instance connected to production Cloud SQL via the Auth Proxy (same pattern as S77 — no separate dev environment exists): `GET /api/coffees` now returns `404`; `GET /api/coffees/archetypes` (the route it was superseded by) still returns `200` unaffected, confirming the removal didn't collateral-damage the router.

**Out of scope, unchanged**: no admin endpoint changes (raw names there are legitimate, gated by `requireAdmin`); no alias data edits; no Task 6/7/8 work.

---

### HOME Task 6 — Brew Cards + the Arrival Note (§3.2, §3.1) (2026-08-02)

#### S79. The loop's shared artifact: the arrival note IS the brew card's first version — and resolves S71's deferred "current coffee" concept

**Context**: `HOME_TASK_6_BREW_CARDS_ARRIVAL_NOTE.md`. Depends on Task 4 (brew profile) and Task 5 (story layer), both live. The irreducible core of the launch per the strategy doc's minimal-lovable-cut note (§6) — kept even when everything else degrades.

**1. Schema — `brew_card`** (new table, applied directly against prod ahead of deploy, same as S72's `token_events.model` column): `id`, `user_id` (FK `user_profile`), `coffee_id` (FK `coffees`), `method` TEXT (matches Task 4's `brewProfile.fields.brew_methods` config whitelist — deliberately not a Postgres enum, since that whitelist is Firestore-config-driven and can change without a migration), `params JSONB` (`ratio`/`grindLabel`/`tempC`/`notes` — customer-language only, never raw dimension jargon), `origin` (`arrival_note` | `conversation`), `revision`, `last_adjustment_reason`, `created_at`/`updated_at`, `UNIQUE(user_id, coffee_id, method)`. Two columns beyond the task's literal list, added deliberately: `arrival_email_scheduled_for`/`arrival_email_sent_at` (both nullable TIMESTAMPTZ) — the arrival note's own delivery-timing state, kept on the card row itself rather than a separate queue table since the card *is* the note's payload.

**2. Recipe generator — `backend/src/services/brewCard.ts`, code + config, zero LLM calls for the numbers.** `computeRecipe(methodKey, dimensionAverages, brewProfile)` is a pure function: a base recipe per method (`config.brewDefaults.methods` — ratio/grindLabel/grindIndex/tempC, one first-draft entry per Task 4's 8 brew methods), shifted by `config.brewDefaults.dimensionDeltas` (three rules shipped: Body/Intensity high → coarser grind; Acidity/Brightness high → cooler temp, low → hotter; Bitterness/Boldness high → coarser and cooler), phrased through the brew profile (`takes_it=milk` → "You take it with milk." appended to `notes`). Grind position is tracked as an index into `config.brewDefaults.grindScale` (7 steps, extra-coarse→extra-fine), clamped at the ends — never an open-ended string mutation. `generateCard()` is fetch-or-create: an existing (user, coffee, method) row is returned as-is, never regenerated — a card's whole point is stability; only `<<card:adjust>>` changes it. Deliberately adjustable, first-draft defaults (not sourced from any external brewing authority) — the point is a deterministic, reproducible starting point that sharpens through cupping deltas and real conversation, not a "correct" recipe on day one.

**3. The arrival note.** Hooks the *same* signal `liamSmsFeedback.ts`'s `schedulePostDeliveryMessage` already uses — the order-placement fire-and-forget block in `orders.ts` — per the task's own explicit instruction not to invent a new signal. Unlike the SMS hook (orders 1-2 only), the arrival card fires on *every* order's primary coffee, since "every bag ships with its own conversation" (§3.1) — but `createArrivalCard()` only schedules a *new* arrival email when the (user, coffee, method) combination is genuinely new; a repeat order of a coffee+method this customer already has a card for (from a prior order or from conversation) doesn't re-trigger a second note for the same card. This is a deliberate v1 scope decision, not an oversight — recorded here so it isn't mistaken for a bug later. Delivery: a new daily cron endpoint, `GET /api/cron/brew-card-arrival-send` (identical shape to `/liam-sms-send` — same `x-cron-secret` gate, same due-row-processing pattern), finds `origin='arrival_note'` cards past their `arrival_email_scheduled_for` (config `brewDefaults.arrivalNote.deliveryDelayDays`, seed 4 — the same no-real-fulfillment-signal approximation the SMS hook already makes, just a shorter delay since this is the earlier "arrival" beat, not the later feedback one) with no `arrival_email_sent_at` yet, renders, and sends via **Resend**, not Mailchimp. Recorded deviation, with reasoning: Mailchimp in this codebase is entirely the pre-purchase welcome-journey tool (tag-triggered, template+merge-field automations — confirmed by reading `launch/40_email-marketing/README.md`), with no mechanism for per-order dynamic recipe content without building new template infrastructure from scratch — a real "template dependency" blocker, exactly the kind the task's own escape hatch anticipated. Resend is already the codebase's transactional-HTML provider for exactly this shape of email (`cron.ts`'s existing sponsored-lapsed/trial-ending sends) — reused, not reinvented, rather than either forcing Mailchimp or shipping a stub. Bag-number-aware length (§3.1): `getBagNumberForCoffee()` computes, live at send time (not stamped at order time), how many times this customer has ordered this coffee via the same `order_line_item → roaster_blend → coffee_id` path other routes already use; only the first-ever bag (`bagNumber < config.brewDefaults.arrivalNote.shortNoteFromBagNumber`, seed 2) gets the content-pipeline warm sentence — later bags render without it, the length-reduction the spec asked for.

**4. `<<card:save>>` / `<<card:adjust=KEY>>`, S51's exact marker pattern, one more type.** `LIAM_BASE_PROMPT` gained a "Brew cards" section (S32-style Good/Bad), directly after Remembering facts: `<<card:save>>` when Liam gives a real recipe for a coffee+method the customer owns; `<<card:adjust=KEY>>` when confirming a change to one already given, `KEY` drawn from a six-value whitelist (`grind_coarser`, `grind_finer`, `temp_up`, `temp_down`, `ratio_stronger`, `ratio_weaker`) spelled out verbatim in the prompt, same "spell out the exact values" fix S73's near-miss bug taught. `chatWithSommelier()` parses and strips both forms into a `cardMarker` field, never trusting anything beyond the literal key. New `resolveCard()` (`sommelier.ts`, exported for testability like every other `resolve*`) is where the actual coffee/method/target-card resolution happens — **scoped to bag/card-anchored sessions only** (`entryCoffeeId` set at `/start`, see below): a general "which coffee is this conversation about" resolver for every session type is out of this task's scope, and a marker with nothing to attach to is silently dropped and logged, the same no-op discipline `open_dial` already has for "no archetype known." `last_adjustment_reason` is the customer's own turn text, truncated to 200 chars — never generated, never inferred.

**5. Home display v1, read-only** — Flavor Memory tab, a new "Brew cards" section (`BrewCards.tsx`) beside the existing brew-profile mirror: alias name (never raw), method, the params line, the adjustment reason when one exists, an "ask Liam about this" link to `/sommelier?entry=card&coffee={id}`. `GET /api/users/flavor-memory` gained an additive `brewCards` array — same pattern Profile Part 7's `activity` field used, alias resolved via `getAliases()` server-side before the response ever leaves the API. No editing UI (Phase 2, per the task's own scope line).

**6. Session context — resolves S71's deferred "current coffee" concept.** `assembleSystemPrompt()` gained a new optional `currentCoffeeContext` param, injected as its own block ("The coffee this conversation is about: …"), independent of the mode-aware catalog/story branch above it and independent of topic — a bag/card-anchored session is grounded for its *whole* duration, not just knowledge-dominant turns. Absent/undefined produces zero difference in the assembled prompt (re-verified below), same guarantee `brewProfileContext` already established. `sommelier.ts`'s `/start` resolves `entry`/`coffeeId` from the request body (arriving from this task's own arrival-note/home-surface links today; Task 7's future QR redirect later, per the `entry=bag` param contract this task defines and Task 7 must honor — ownership is established by whichever entry point produced the link, not re-checked here, and every card this resolves is scoped to the requesting uid's own `user_profile.id` regardless, so a forged `coffeeId` can only ever touch that customer's own card) — fetches or generates the relevant card, stores `entryCoffeeId`/`entryMethod` in `context_data`, and builds the context string (alias + method + recipe + the coffee's published-story first sentence, not the full 120-200 word text — a light, session-wide grounding line, not a duplicate of the topic-triggered full story injection). `/message` rebuilds it live every turn (not cached) since `<<card:adjust>>` can change the card mid-conversation.

**Config pushed live**, not via the admin UI's own config-drift/config-apply HTTP endpoint (no interactive admin session available, same situation S71/S72/S74 hit) but via the identical operation run directly: one new path, `brewDefaults` (the entire object — methods, dimensionDeltas, adjustments, archetypeDefaultMethod, arrivalNote, grindScale), confirmed genuinely new before applying (not already present live), applied via Firestore's dot-path update + the same `config/sommelier/audit/{autoId}` write the mechanism performs, 0 remaining drift after.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy + a live backend instance, marked test data, full cleanup):
- `tsc --noEmit` and `vite build` both clean.
- **Determinism, the verification asked for most directly**: `computeRecipe()` called twice with byte-identical inputs → byte-identical output (deep-equal JSON). A second call with different (high) dimension averages produced a different result than a flat/neutral set, proving the deltas actually apply, not just decorate. No-cupping-data and unknown-method inputs both degrade to a sane, still-deterministic fallback rather than throwing.
- **The matching-mode byte-diff, re-run exactly as the environment note asked**: `assembleSystemPrompt()` with `currentCoffeeContext` omitted vs. included — stripping the new block from the "included" output reproduces the "omitted" output character-for-character; expertise mode with no story and no current-coffee context still omits the catalog with nothing injected in its place, confirming the S71-era omit branch's own behavior is untouched.
- **Full dev flow, real production data, no fabricated success**: `createArrivalCard()` called directly against a real coffee (id 31, published story, real cupping data) — first call inserts (`isNewCard: true`, `origin: 'arrival_note'`, `arrival_email_scheduled_for` ~4 days out), second call for the same (user, coffee, method) fetches the identical row rather than regenerating (`isNewCard: false`, byte-identical params) — proving the "repeat order doesn't re-trigger a second note" decision above actually holds in code, not just in the design doc. `getBagNumberForCoffee()` confirmed correct against real order history. `buildArrivalNoteEmail()` rendered with real data: contains the alias ("Jammy & Aromatic"), the ratio/grind line, and a correctly-parameterized talk-to-Liam link; grepped the output directly for the coffee's real raw name ("Kenya") and its roaster — neither present.
- **`processArrivalNotes()`'s scheduling logic**: a card scheduled ~4 days out was correctly skipped by a run of the cron function; backdating `arrival_email_scheduled_for` to the past made it correctly selected and attempted on the next run. **Honest limitation, not silently glossed over**: this environment's `RESEND_API_KEY` is the pre-existing local placeholder (`re_local_placeholder`, documented in [[axis_and_bloom_local_cloudsql_testing]] as sufficient to boot the server but not to prove a real send) — the Resend SDK call didn't throw against the placeholder key (consistent with `cron.ts`'s two pre-existing lapsed/trial-ending sends, which have the identical no-error-checking pattern, not something this task introduced), so `arrival_email_sent_at` got marked without a provable real delivery. The render, the selection query, and the scheduling/marking logic are all verified directly; actual Resend delivery is not, and can't be in this environment — flagged here rather than claimed.
- **The full conversation round-trip, against the live production backend, not a unit mock**: opened a real session with `entry=bag&coffee=31` — the opening message correctly referenced the coffee by its alias ("You're in the floral range with the Jammy & Aromatic…", never the raw name), and `context_data.entryCoffeeId`/`entryMethod` matched exactly what was resolved. Sent "The V60 you gave me for this bag came out too bitter — can we go coarser next time?" — Liam replied "Coarser it is — that should take the edge off." with no stray `<<card:` token in the customer-facing text; the card's `grindLabel` moved `medium-fine` → `fine` (exactly the configured +1 step), `revision` incremented 1→2, and `last_adjustment_reason` recorded the customer's own sentence verbatim. `GET /api/users/flavor-memory` immediately reflected the updated card with the alias name, confirming the home surface and the conversation write to the same row.
- **The S44-style grep, on every new render path**: `brewCard.ts`, the new `cron.ts` arrival-email code, `users.ts`'s new `brewCards` block, `sommelier.ts`'s new `buildCurrentCoffeeContext()`, and `BrewCards.tsx` all grepped for `coffees.name`/`c.name`/raw roaster reads. One legitimate raw-name read found and verdicted, not fixed (it doesn't need to be): `cron.ts`'s arrival-email builder selects `coffees.name`/`roaster` solely as the `identity` param passed to `generateBrewNoteSentence()`'s specificity *check* — a comparison target, never rendered, the exact same pattern S38/S74 already established and audited for `storyLayer.ts`'s other generation functions. Everything else was alias-correct by construction.

**Nothing else touched, per the task's explicit scope**: no QR/redirect endpoint (Task 7's own — the `entry=bag` param contract is defined here for Task 7 to honor, not built here); no SMS delivery (Task 8's own); no card-editing UI (Phase 2); no changes to the six intents, topic router, or guard layer.

**Still needs manual setup, same as S17's original CRON_SECRET/Scheduler note**: `GET /api/cron/brew-card-arrival-send` exists and is verified correct, but nothing calls it yet — a Cloud Scheduler job (daily, alongside the existing `liam-sms-send` job, same `x-cron-secret` header, already live in Secret Manager) needs to be created pointing at this new path before any arrival note actually goes out in production. Not blocking this task's own verification (called directly, per the Verified section above), but blocking real delivery.

---

#### S80. `brew_card` renamed to `user_brew_card` — naming-convention fix, no logic change

**Context**: small, single-purpose follow-up to S79 — `brew_card` didn't match this codebase's established `user_*` table-naming convention (`user_tokens`, `user_profile`, `user_bloom_dial_current_position`).

`ALTER TABLE brew_card RENAME TO user_brew_card`, applied directly against prod, same pattern as the table's original S79 creation. Postgres does **not** auto-rename a table's dependent constraints/indexes/sequence when the table itself is renamed — confirmed by inspecting `pg_constraint`/`pg_indexes` immediately after the rename, which still showed `brew_card_pkey`, `brew_card_user_id_coffee_id_method_key`, `brew_card_coffee_id_fkey`, `brew_card_user_id_fkey`, `brew_card_origin_check`, and the `brew_card_id_seq` sequence, all untouched. Each was renamed explicitly to its `user_brew_card_*` equivalent in the same pass. `schema.sql` updated to match (`CREATE TABLE IF NOT EXISTS user_brew_card`) — the inline, unnamed constraint declarations there will auto-generate the same `user_brew_card_*` names on a fresh environment, so no explicit constraint-name lines were needed in the schema file itself.

Repo-wide grep for `brew_card` found and fixed every runtime SQL reference: `brewCard.ts` (9 queries), `cron.ts` (2 — one caught on a second, broader grep pass after the first targeted read missed it further down the same function), and a doc-comment in `sommelier.ts`. `frontend/src` had none. Left untouched, deliberately: `HOME_TASK_6_BREW_CARDS_ARRIVAL_NOTE.md` (the original task spec — a historical record of what was asked, not runtime code) and every existing S79/#132 build-log prose reference to "the brew card" as a concept (English usage, not the SQL identifier).

**Verified**: `tsc --noEmit` clean. Two of S79's own verifications re-run directly against prod to prove nothing broke: `generateCard()`'s fetch-or-create on a marked test user — first call inserted, second call for the same (user, coffee, method) fetched the identical row (byte-identical params), confirmed present in `user_brew_card` directly; `GET /api/users/flavor-memory` (real authenticated call) correctly returned the card in `brewCards` with its alias name intact. Test user/card cleaned up after.

**Nothing else touched**: no logic changes, no new columns, no config changes — this is a rename only.

---

### HOME Task 8 — Beats v1 + Twilio (§3.1) (2026-08-02)

#### S81. The bag cycle's first three beats — lifecycle-aware, degrading gracefully, and the SMS cutover that finally closes the S76 loop

**Context**: `HOME_TASK_8_BEATS_V1.md`. Depends on Task 6 (brew cards, live). The empty-bag reorder beat is explicitly **not** this task's — Phase 4, confidence-gated, deliberately left alone.

**1. Schema — `beat_event`** (new table, applied directly against prod ahead of deploy, same pattern as every prior task's schema addition): `user_id`/`order_id`/`coffee_id`, `beat_type` (`order_placed`|`arrival_note`|`dial_in`), `channel` (`sms`|`email`|`inline` — `inline` for the order-placed line, which is injected into the order-confirmation response itself, never dispatched through a channel), `scheduled_at`/`sent_at`/`responded_at`, `skip_reason`. `UNIQUE(user_id, order_id, beat_type)` is the idempotency guarantee the verification cared about most — every insert in `beatEngine.ts` is `ON CONFLICT DO NOTHING`, and the associated work (line generation, card creation, scheduling) only runs when the insert actually happened. Also added: `user_phone.sms_beats_opt_in`/`sms_beats_opt_in_at` (the extended consent spec item 6 asks for — deliberately distinct from the legacy `sms_opt_in`, which only ever covered the post-delivery feedback ask; no UI toggle built for it this pass, per the task's own scope note that the consent copy itself is Dana's calendar item) and `sommelier_sms_feedback.message_kind`/`beat_event_id` (lets the inbound SMS webhook tell a beat reply apart from a legacy reply without touching `parseInboundReply()`'s own signature).

**2. The beat engine — `backend/src/services/beatEngine.ts`.** `selectBeats(userId, coffeeId)` computes all three beats' eligibility from `config/sommelier.beats` — no hard-coded cases, every active flag/timing offset/lifecycle condition reads from config. Split into two dispatch functions rather than one, because the beats fire at genuinely different points in the request lifecycle:
- `dispatchOrderPlacedBeat(userId, orderId, coffeeId)` — **synchronous**, called before `orders.ts` responds, since the line is injected into the order-confirmation response itself (spec item 2's "no conversation attached" reading: generated once, inline, not a background job).
- `dispatchDelayedBeats({userId, orderId, coffeeId, brewProfile})` — fire-and-forget, same trigger point Task 6's arrival-card hook and the (now-superseded, see below) legacy SMS scheduling both used. Owns `arrival_note` (wraps Task 6's `createArrivalCard()`, now gated through the engine's active-flag/channel decision and `beat_event` bookkeeping instead of an unconditional call) and `dial_in`.

**3. Lifecycle-aware selection, all config-driven:**
- **Bag number** — reused, not duplicated: `brewCard.ts`'s `getBagNumberForCoffee()` (Task 6) computes it live from real `order_line_item` history.
- **Repeat coffee → skip dial-in** — `config.beats.types.dial_in.skipIfRepeatCoffee` (seed `true`), checked against `bagNumber > 1`. `skip_reason: 'repeat_coffee'` recorded on the `beat_event` row, not just implied by its absence.
- **Degrade-on-silence** — a trailing-window responded/sent ratio over this user's most recently *sent* beats (`config.beats.degradeOnSilence`, seed `windowSize: 5, minResponseRate: 0.2`). Fewer than `windowSize` sent beats in history → not enough data to judge, never degrades a new user on thin evidence. Below the rate → `dial_in` drops (`skip_reason: 'degraded_silence'`) but **`arrival_note` never drops** — it's the floor of the minimal set (§3.1's "never a nag, never a re-send," not "never a note at all"), gated only by its own active flag.
- **Lifecycle stage** (`classifyStage()` output) — read via the stored `user_lifecycle_state`/`user_lifecycle_stage` join, per the task's own "read its output, never its internals" instruction; not currently used to gate any of the three v1 beats directly (none of the spec's three beats needed a stage-specific rule beyond bag-number/repeat-coffee), but the read path exists and is real, ready for a future beat that does.

**4. The order-placed line.** New `generateOrderPlacedLine()` in `storyLayer.ts`, sharing a newly-extracted `generateOneWarmSentence()` helper with Task 6's `generateBrewNoteSentence()` (same content pipeline, same alias-only/specificity discipline, same one-retry-then-generic-fallback shape — the two functions differed only in their prompt core and fallback text, so the retry/fallback loop itself was de-duplicated rather than copy-pasted a second time). Injected into `POST /api/orders`'s synchronous JSON response as `orderPlacedLine`; `CartContext.tsx`'s checkout success message now shows it in place of the old static `'Order placed!'` string, falling back to that same string if generation failed or the beat is inactive.

**5. The arrival note** — unchanged mechanically from Task 6 (`createArrivalCard()`, `processArrivalNotes()`, the cron), now wrapped by the engine's own active-flag check and `beat_event` bookkeeping rather than called unconditionally from `orders.ts`.

**6. First-brew dial-in.** `config.beats.types.dial_in.timingOffsetDays` (seed `3`) — anchored directly to order-placement time, the same order-date-plus-N approximation the legacy 10-day SMS already used (no real delivery-tracking signal exists to anchor to instead), deliberately a distinct value from both that legacy 10 days and Task 6's own 4-day arrival delay. New cron `GET /api/cron/beat-dial-in-send` (`processDueDialInBeats()`, `cron.ts`) finds due rows and delivers on the beat's recorded channel — email this pass, always (see gating below). The reply path, per the task's own two named options:
- **On-site, "via the card's door"**: new `GET /api/beats/dial-in/:beatEventId/respond?expectation=lighter|as_expected|bolder` (`routes/beats.ts`) — a capability link (the emailed `beatEventId` itself, not a login) in the same single-click spirit as a calendar RSVP or unsubscribe link; the email's three quick-response buttons point straight at it.
- **SMS, "via existing webhook parsing"**: `parseInboundReply()` (`liamSmsFeedback.ts`) now *returns* its parsed `{expectation}` (additive — every existing caller already ignored the previous `void` return) instead of only writing it internally; the webhook route checks the outbound row's new `message_kind`, and if `'beat_dial_in'`, feeds the returned expectation into the same shared handler below. `parseInboundReply()` itself knows nothing about beats — reused exactly as written, not modified beyond the return value.

Both paths converge on one shared function, `respondToDialInBeat(beatEventId, expectation, source)` (`beatEngine.ts`) — spec item 2's "the reply... adjusts the brew card (Task 6's adjust path) and writes the feedback event via `dialPositionSignal.ts`," built once, not twice. Writes `dial_position_signal` (`source` is `'sms_feedback'` or `'onsite_feedback'` depending on which path produced the reply — `dial_position_signal.source`'s own `CHECK` constraint only allows those two plus `cupping`/`roastery_wheel`/`client_wheel`, so no new source value was invented). Maps `bolder`→`grind_coarser`/`lighter`→`grind_finer` (next time, less/more extraction) via Task 6's existing `adjustCard()`, `as_expected`→no adjustment (the card's already right). Idempotent: a `beat_event` that already has `responded_at` is a no-op, returns `false` — a stale link clicked twice, or a prefetching email client, can't double-adjust the card.

**7. Twilio, code-complete, fully gated.** `sendSms()` (`smsProvider.ts`) now makes a real Twilio REST call (plain `fetch`, Basic Auth, no SDK dependency added — same "raw fetch over a heavy client" preference this codebase already shows for Mailchimp) using `SMS_PROVIDER_ACCOUNT_SID`/`SMS_PROVIDER_AUTH_TOKEN`/`SMS_FROM_NUMBER` from GCP Secret Manager, wired into `deploy.yml --set-secrets` the same way `CRON_SECRET` was (S17). **Created all three secrets in Secret Manager with clearly-labeled placeholder values** (`placeholder_not_real_twilio_*`) specifically so referencing them in `deploy.yml` doesn't break the next deploy — Cloud Run's project-level `roles/secretmanager.secretAccessor` binding covers new secrets automatically, confirmed before relying on it. The provider interface (`SmsMessage` in, `SmsSendResult` out) is byte-for-byte unchanged, per the task's own instruction, so a future real-provider swap still only touches this one function body. **Every real SMS call site stays gated behind `config.beats.smsEnabled` (seed `false`) AND the extended `sms_beats_opt_in` consent** — email is the only live channel this pass, exactly as the environment note specified. `dial_in`'s SMS path, once flipped on, reuses `sommelier_sms_feedback` + the existing `processPendingMessages()` cron for the actual send (not a second scheduling mechanism) — an outbound row is inserted with `status: 'scheduled'`, `message_kind: 'beat_dial_in'`, `beat_event_id` set, and the unchanged cron picks it up.

**8. The supersede cutover — the audit the task called non-negotiable.** `orders.ts` no longer calls `schedulePostDeliveryMessage()` at all. This is a full cutover, not a per-order conditional check: every order from this deploy forward goes through the beat engine's `dial_in` beat instead, so a customer can never receive both for the same bag — the literal failure mode the audit exists to prevent, closed structurally rather than checked defensively. `schedulePostDeliveryMessage()`, `processPendingMessages()`, and `parseInboundReply()` are all left exactly as they were (a comment at the top of `liamSmsFeedback.ts` now documents why they're still there, unused from this call site but not dead code) — `sommelier_sms_feedback` rows already scheduled before this deploy still process normally on the unchanged cron; nothing here rewrites or cancels historical rows.

**9. A real pre-existing bug found and fixed along the way, not in scope but directly blocking verification of my own new email link.** `FRONTEND_URL` was never actually set on the Cloud Run service — `deploy.yml` had no `--set-env-vars` at all, confirmed by querying the live service's env directly. Every email link built with `process.env.FRONTEND_URL ?? 'http://localhost:5173'` — including **Task 6's own arrival-note "talk to Liam" link (S79)** and the pre-existing sponsored-lapsed/trial-ending emails' `/profile` link — has been pointing at `localhost` in production since S79 shipped. Fixed by adding `--set-env-vars "FRONTEND_URL=https://www.axisandbloomcoffee.com,BACKEND_URL=..."` to `deploy.yml` (the latter newly needed for this task's own dial-in respond link, which points at the backend directly rather than the SPA). Flagged here rather than silently folded in as "just config" — it's a real, dormant production bug this task's own work happened to surface.

**Config pushed live**, same direct-operation pattern as every prior task with no interactive admin session available: one new path, `beats` (the entire object), confirmed genuinely new before applying, applied via Firestore's dot-path update + the same `config/sommelier/audit/{autoId}` write the mechanism performs, 0 remaining drift after. Live `beats.smsEnabled` confirmed `false` post-apply.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy, marked test data, full cleanup):
- `tsc --noEmit` and `vite build` both clean.
- **Idempotency, the verification asked for most directly**: called `dispatchOrderPlacedBeat()` twice for the same order — first call inserted the `beat_event` row and generated a real line; second call found the existing row (`ON CONFLICT DO NOTHING` returned no rows) and correctly returned `null` without a second Haiku call. Called `dispatchDelayedBeats()` twice for the same order — `arrival_note` and `dial_in` `beat_event` counts stayed at exactly 1 each after the second call, and the brew card's `id` was identical before and after (no duplicate creation), directly proving "re-fire the arrival signal, confirm no duplicate."
- **Repeat-coffee skip**: a second real order for the same (user, coffee) — `bagNumber` correctly read `2`, `dial_in.active` was `false`, and `skip_reason: 'repeat_coffee'` was present both in the returned selection and read back directly from the `beat_event` row.
- **Degrade-on-silence**: seeded 5 sent-but-never-responded `dial_in` `beat_event` rows for a test user (on a coffee distinct from the repeat-coffee test, to isolate the condition — the first attempt conflated the two by reusing the same coffee, correctly surfaced `repeat_coffee` instead since that check runs first, which is itself the right precedence for a genuinely dual-condition case; re-run in isolation confirmed `degraded_silence` fires cleanly on its own). `dial_in.active` was `false` with `skip_reason: 'degraded_silence'`; `arrival_note.active` stayed `true` — the minimal-set floor holding exactly as designed.
- **The full reply round-trip, against real production data**: backdated a real `dial_in` `beat_event`'s `scheduled_at`, ran `processDueDialInBeats()` — it selected the due row, rendered and sent a real email (Resend), marked `sent_at`. Called `respondToDialInBeat(id, 'bolder', 'onsite_feedback')` directly — the brew card's `grindLabel` moved `medium-fine` → `fine` (the configured `grind_coarser` step), `revision` incremented, a `dial_position_signal` row was written with `direction: 'more'`, and `beat_event.responded_at` was set. A second call to the same function returned `false` and left the card's revision unchanged — the reply-idempotency the task's own "card door" framing implies but doesn't explicitly test for, verified anyway.
- **Supersede audit**: after dispatching beats for two real test orders, `sommelier_sms_feedback` had zero rows for that user — confirming no legacy scheduling occurred alongside the new beat dispatch, structurally (the call site is gone) rather than just observed-empty-this-once.
- **Twilio, real network call, not mocked**: `sendSms()` against the placeholder credentials made a genuine request to Twilio's live API and got back a real `401 Authentication Error — invalid username` — proving the request shape (endpoint, Basic Auth header construction, form-encoded body) is correct and would work the moment real credentials replace the placeholders; failed gracefully (`{success: false, error: ...}`, no throw), exactly as designed.
- SMS body length: `buildDialInSmsBody()`'s primary variant checked programmatically, same S15/S53 pattern (109 chars for a realistic alias+method combination, well under 160).

**Nothing else touched, per the task's explicit scope**: no empty-bag reorder beat (Task 12's own); no palate prompts (Task 11's own); carrier registration itself is Dana's calendar item, untouched here.

**Still needs manual setup**: a Cloud Scheduler job for `GET /api/cron/beat-dial-in-send` (same pattern as S79's own still-open `brew-card-arrival-send` job — both need creating); A2P carrier registration and the extended opt-in consent copy, both explicitly Dana's calendar items per the task's own environment note.

---

### HOME Task 7 — The QR Door (§3.1, QR indirection) (2026-08-02/03)

#### S82. Per-coffee opaque tokens, the redirect endpoint's five destinations, the sponsorship seam that was already in schema, and a real anonymous-auth bug caught by actually running the signed-out flow

**Renumbered from a draft "S81"** — Tasks 7 and 8 ran concurrently in one working tree and both independently drafted their entry as S81 before either had committed (see house convention #9). Per house convention #9's resolution rule, S81 (below, Task 8) is the entry that appears first in this file, so it kept the number; this entry moved to S82. If you're orienting from an old note or draft that called this "S81," this is that entry.

**Context**: `HOME_TASK_7_QR_DOOR.md`, depends on Task 5 (story page — live) and Task 6 (bag/brew-card surface — live, S79/S80). The rule this task exists to honor, verbatim from the strategy doc: **never print a URL whose meaning is fixed — print a pointer the server re-aims.** An alias in a URL would be S44 baked in ink.

**1. Schema — one `qr_token` column on `coffees`, not a separate table.** The spec's own decision point ("`coffee_qr_token` table if multiple tokens per coffee ever needed") resolves cleanly against the strategy doc's own words — "One code per coffee, not per bag" — so a plural join table has nothing to model. `qr_token TEXT`, nullable until minted, partial unique index (`WHERE qr_token IS NOT NULL`), generated via `randomBytes(16).toString('hex')` (32 hex chars, well over the spec's ≥16 floor) — same app-generated-token convention `household_invitation.token` already established, not a new pattern. Minted for real, for all 30 production coffees, via `mintTokensForAllCoffees()` — not test data, the actual deliverable.

**2. No bare `/b/{token}` Express route can exist.** Checked before writing anything: every router in `backend/src/index.ts` mounts under `/api/*`, and this backend serves no static frontend assets — the SPA is a separate deploy. `/b/:token` is therefore a **frontend route** (`QrDoor.tsx`) that calls a new public `GET /api/qr/:token/resolve` (`optionalAuth`, so auth state only changes the destination, never blocks resolution) and renders whichever of five states comes back — the identical split `/coffee/:id/story` + `GET /api/coffees/:id/story` already uses, not reinvented.

**3. The five destinations, plus the retired-coffee page extension Task 5 explicitly deferred here.** Unknown token → inline "that code doesn't match anything we know" state, no stack trace. Retired (no `roaster_blend` row with `is_active = true` for that coffee — **no dedicated retired/active column exists on `coffees`**, this is an inferred convention, confirmed against a real production coffee that has cupping and story data but zero active blends) → redirects to `/coffee/:id/story?retired=1&nearestHop=`, and `CoffeeStoryPage.tsx` (whose own header comment named this exact task as the one to build it) now renders a past-tense banner plus a "closest relative" CTA when a nearest hop exists — UI chrome around the existing story text, not a rewrite of story content itself, per this task's own scope line. Signed out → `/sign-in?redirect=/b/{token}`, hand-built in the same shape `RequireAuth.tsx` builds internally (S21), since this route is deliberately *not* `RequireAuth`-wrapped — retired/non-owner/unknown all need to resolve without forcing sign-in first. Signed-in non-owner → the same story page, no query params, "the public story-layer page with a path to the quiz" the strategy doc asks for (already built into that page). Signed-in owner → the bag view, rendered **inline on `/b/:token` itself** — no dedicated single-card page existed before this task (`BrewCards.tsx` is a list section on the Profile tab only) — reusing Task 6's exact fetch-or-create card pattern (`getMostRecentCard` else `generateCard` via `resolveDefaultMethod`) and linking to `/sommelier?entry=bag&coffee={id}`, Task 6's own contract, honored not reinvented.

**4. A real bug, caught by actually running the signed-out flow, not assumed correct.** Every visitor to this site gets an anonymous Firebase session automatically (`AuthContext.tsx`'s `signInAnonymously()`, fired whenever there's no user yet), and the frontend's `getHeaders()` attaches that anonymous user's real ID token to every request, including the resolve call. The first version of `GET /api/qr/:token/resolve` treated any decoded `req.uid` as "signed in" and proceeded straight to ownership resolution — so a guest's first-ever scan, **the strategy doc's own named "majority case for a first scan,"** silently resolved to the public story page instead of the sign-in prompt the whole design exists to show at that exact moment. This surfaced live: the first real pass through the browser's signed-out flow landed on the story page instead of `/sign-in`, traced through IndexedDB's persisted Firebase session (`isAnonymous: true`) to this exact gap. Fixed by mirroring `RequireAuth.tsx`'s own already-established rule (`if (!user || isGuest)`) inside the resolve handler: `isRealSignIn = !!req.uid && !req.isAnonymous`. Re-verified against a genuinely fresh backend process after the fix (a first "restart" attempt turned out to have only killed the `cmd.exe` wrapper, not the underlying `node` process — caught by checking `Get-NetTCPConnection`'s actual owning PID before trusting a health check) — the anonymous session's real ID token now correctly resolves to `sign_in`, and the full sign-in→return loop was then walked end-to-end through the real `SignIn.tsx` UI.

**5. Ownership — two independently pluggable checks, per the environment note's exact instruction not to invent a sponsorship schema.** `checkPersonalOrderOwnership`: the standard `order_line_item → roaster_blend → coffee_id` path, `WHERE o.user_id = profileId`, same shape `brewCard.ts`'s `getBagNumberForCoffee()` and `users.ts`'s flavor-memory route already use. `checkSponsorshipOwnership`: reads `order_line_item.intended_for_user_id` — grepped and confirmed this column has existed in `schema.sql` since before this task but had **zero reads or writes anywhere in `backend/src`** until now. Not invented — the real B2B/company-gift data model (`company_gift`/`company_gift_code`/`user_profile.company_gift_id`, `routes/companyGiftRedemption.ts`) links a company to a subscription but never to a specific order line, and today's fulfillment orders already carry `order.user_id` = the receiving employee's own profile regardless of who paid — so `checkPersonalOrderOwnership` already covers the ordinary sponsored case. `intended_for_user_id` is the one real, currently-dormant seam for the case it wouldn't (an order attributed to a different login than the one it's for). A `TODO` comment at the query site notes that no checkout/gifting flow writes to this column yet, wired to the B2B workstream for whenever one does — no code change will be needed there when it lands. **Verified with a real row, not a stub**: a third-party "placer" test account placed a real order with `intended_for_user_id` set to a separate "sponsored" test account that never placed an order of its own — the sponsored account's scan correctly resolved to `owner`. (First attempt at this test was confounded — the "non-owner" account had also been reused as the order's placer, so it legitimately satisfied `checkPersonalOrderOwnership` too; a test-isolation mistake, not a code bug, caught and corrected before trusting the result.)

**6. Scan logging — the engagement metric's only data source, per the closing pass.** `qr_scan_event`: token, coffee_id, `auth_state`, `destination`, `user_id` (nullable), `scanned_at`. `auth_state` deliberately extends the spec's literal three named values (`owner`/`signed_out`/`non_owner`) with a fourth, `unresolved` — for the unknown-token and retired-coffee cases, where ownership is never evaluated at all, so neither "owner" nor "non_owner" would be an honest label (a signed-in customer scanning a retired coffee they genuinely did buy is not a "non_owner" — the check simply never ran). Logged here as a deliberate, documented extension rather than a silent best-fit guess.

**7. A pre-existing schema/live drift found and routed around, not fixed.** `sommelier(Rag).ts` queries `v_dial_navigation` for `vdn.from_coffee_id`/`to_coffee_id` in its own `discovery`/`alternatives` RAG focus code — but the view's definition checked into `schema.sql` (unchanged since `bloom_dial_seed_2026_06_23.sql`) only selects `from_coffee`/`to_coffee` as **names**. The only way `sommelierRag.ts`'s existing, working queries make sense is if the live view was altered directly against prod at some point after the original migration, without `schema.sql` ever being updated to match — the exact seed-vs-live drift class Task 1 exists to catch, just for a view object instead of Firestore config. Confirmed this isn't a one-off guess: `GET /api/admin/dial/navigation` (pre-existing, `admin.ts`) already queries `dial_coffee_relationships` directly rather than the view, for what must be the identical reason. The retired-coffee nearest-hop lookup here does the same — queries the base table directly, verified column-by-column against `schema.sql`'s own `CREATE TABLE dial_coffee_relationships`. Re-running the checked-in `CREATE VIEW v_dial_navigation` as written would silently break `sommelierRag.ts`'s own live queries — flagged here as a real landmine for whoever next touches the Bloom Dial views, out of this task's own scope to fix.

**8. Admin — mint + export, one fix caught before calling it done.** `POST /api/admin/qr/mint/:coffeeId` and `/mint-missing` (idempotent, `router.use(requireAdmin)` gate already covers both, no per-route auth needed). `GET /api/admin/qr/tokens` for the label-artwork export list. First version's display-name fallback was weaker than the customer-facing resolve endpoint's own (`Coffee ${id}` instead of the archetype-label fallback `resolveQrDisplayName()` already uses) — caught by reading the actual output against real production coffees (several genuinely showed "Coffee 7" instead of an archetype label) and fixed to match, so the admin list never shows a customer a worse name than a real scan would. **URL-only export, no server-side PNG** — a deliberate decision, not a punt: the spec explicitly allows either, and adding a QR-rendering npm dependency to a production backend for a page whose output a label designer's own tool can generate directly from the exported URL wasn't worth the footprint.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy + a local backend instance pointed at prod, marked test data, full cleanup):
- `tsc --noEmit` clean (backend). No `tsconfig.json` exists anywhere in `frontend/` — checked directly, not assumed — so `vite build` is this codebase's actual frontend correctness gate, not `tsc --noEmit`; ran clean.
- **All five destinations exercised for real**, both by direct API call and by a real signed-in/signed-out browser session, screenshotted at each: unknown token (404, friendly state); retired coffee (a real one found in production — coffee 14, cupping/story data present, zero active `roaster_blend` rows — correctly routed past-tense, correctly showed no hop CTA since this particular coffee has no outgoing recommended hop in the real graph); owner (a real generated brew card, real cupping-derived recipe, for a real coffee); the full **signed-out → sign-in → return** loop walked through the actual `SignIn.tsx` UI, landing back on `/b/:token` showing the bag view exactly as if the scan had continued uninterrupted; non-owner (redirected cleanly to the public story page).
- **`qr_scan_event` rows confirmed for every path**, correct `auth_state`/`destination`/`user_id` combination, read directly from the table before cleanup.
- **Sponsorship seam proven in isolation** (item 5 above) — the pluggable check resolves ownership through `intended_for_user_id` alone, with no personal order backing it.
- All test users, orders, and scan events were marked (`CLAUDE_QR_TEST%` promo codes, `claude-qr-test-*@example.com` emails) and deleted after verification, confirmed zero remaining via a direct re-query. The 30 real minted `qr_token` values were deliberately left in place — that's the deliverable, not test residue.
- **Honest limitation, not glossed over**: no real phone scan of a printed code happened in this pass. No label artwork exists yet (a separate design workstream the strategy doc itself flags as an open logistics item), and this environment has no printer. The redirect/resolve logic is fully verified end-to-end against real production data and a real browser; the physical loop itself is the one piece that needs Dana, once even draft artwork exists to print.

**Nothing else touched, per the task's explicit scope**: no label artwork (design workstream); no story-page or brew-card *content* changes, only routing to the pages that already render them; no per-bag serialization anywhere — one token per coffee, exactly as specified.

**Still needs**: a real printed (even draft) code, scanned once from a phone, before mass print QA becomes someone else's checklist item (the task's own words). Label-design pass itself (whose printer, final material) is Dana's calendar item, per `HOME_TASK_INDEX.md`.

---

### HOME Task 8b — Post-Merge Fix Pass (2026-08-03)

#### S83. The S-number collision that had already resolved itself, the env-var class closed, and four retired coffees given a real story

**Context**: `HOME_TASK_8B_POSTMERGE_FIX_PASS.md`. Tasks 7 and 8 ran concurrently in one working tree — a real violation of house convention #9 ("one Claude Code session per working tree"), which this incident is why that convention now exists. Both tasks survived it through careful file discipline (git plumbing on `index.ts`, per [[feedback_axis_and_bloom_task_execution]]), but still needed a cleanup pass before Task 9.

**Step 0 — working-tree sanity.** `git status` + `git log --oneline -15` confirmed both `d34b8e4` (Task 7) and `08f09a2` (Task 8) fully committed and already pushed to `origin/main` before this pass began — no half-staged files remained from either session's own git-plumbing work on `index.ts`. Only pre-existing, unrelated untracked clutter remained (`home_v3/` task docs, marketing PDFs, a `slot_instance_model/` directory not created by this task), confirmed not this pass's and left untouched.

**Step 1 — the S-number collision, already resolved by the time this pass started.** The task brief (and the live conversation that triggered this pass) described the collision as still unresolved. Checked the actual file before touching anything, per this pass's own house-convention discipline: it wasn't. S81 (Task 8, appears first in the file) had already correctly kept its number; the Task 7 session's own commit had already used S82 — the exact rule this task specifies ("whichever entry appears first keeps S81") had already been satisfied, apparently worked out independently by the two sessions' own build-log writes landing in commit order. Grepped all three build logs (`SOMMELIER_BUILT.md`, `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`) plus every `home_v3/` task file for `S81`/`S82`: found exactly one real dangling reference — `WHAT_WE_BUILT.md` #134's own self-citation still read "`SOMMELIER_BUILT.md` S81" for the QR Door entry (should be S82; #133's Beats v1 citation was already correct at S81) — fixed. Added the renumber-orientation note to S82's heading, per the task's own instruction, so a reader following an old "S81" reference from either session's working notes can still orient. Verified: exactly one S81 heading, one S82 heading in this file, all four cross-references (`WHAT_WE_BUILT_DB.md` ×2, `WHAT_WE_BUILT.md` ×2) correct.

**Step 2 — the dormant-env-var audit.** Confirmed via GitHub's Actions API that the `FRONTEND_URL` fix (deploy `08f09a2`) had already run and succeeded, then confirmed directly against the live service (`gcloud run services describe axis-bloom-backend`) rather than trusting the deploy's exit code alone: `FRONTEND_URL=https://www.axisandbloomcoffee.com` and `BACKEND_URL=https://axis-bloom-backend-oiub7eumya-uc.a.run.app`, both plain env vars, both correctly present. Grepped `process.env\.` across the whole of `backend/src` for every distinct variable and verdicted each against `deploy.yml`'s `--set-secrets`/`--set-env-vars` and the live service's actual env array (`gcloud ... --format=json`, distinguishing a plain `value` from a `valueFrom.secretKeyRef` for each):

| Variable | Source | Verdict |
|---|---|---|
| `DATABASE_URL` | Secret Manager | secret-and-live |
| `ANTHROPIC_API_KEY` | Secret Manager | secret-and-live |
| `FIREBASE_PROJECT_ID` | Secret Manager | secret-and-live |
| `FIREBASE_PRIVATE_KEY` | Secret Manager | secret-and-live |
| `FIREBASE_CLIENT_EMAIL` | Secret Manager | secret-and-live |
| `SHOPIFY_STORE_DOMAIN` | Secret Manager | secret-and-live |
| `SHOPIFY_STOREFRONT_TOKEN` | Secret Manager | secret-and-live |
| `SHOPIFY_ADMIN_TOKEN` | Secret Manager | secret-and-live |
| `RESEND_API_KEY` | Secret Manager | secret-and-live |
| `MAILCHIMP_API_KEY` | Secret Manager | secret-and-live |
| `MAILCHIMP_LIST_ID` | Secret Manager | secret-and-live |
| `CRON_SECRET` | Secret Manager | secret-and-live |
| `SMS_PROVIDER_ACCOUNT_SID` | Secret Manager | secret-and-live |
| `SMS_PROVIDER_AUTH_TOKEN` | Secret Manager | secret-and-live |
| `SMS_FROM_NUMBER` | Secret Manager | secret-and-live |
| `FRONTEND_URL` | `deploy.yml --set-env-vars` | set-and-live (this pass's parent bug, confirmed closed) |
| `BACKEND_URL` | `deploy.yml --set-env-vars` | set-and-live (this pass's parent bug, confirmed closed) |
| `NODE_ENV` | none | intentionally-absent — `db/client.ts`'s only use gates the `ssl` option, and production always connects over the Cloud SQL unix socket (`isUnixSocket` true), which already forces that branch off regardless of `NODE_ENV`; the variable's absence has zero effect on the deployed path |
| `PORT` | none | intentionally-absent — Cloud Run injects this automatically for every container (default `8080`); `index.ts`'s `process.env.PORT ?? 4000` resolves it at the platform level, `deploy.yml` never needs to set it |

Zero vars found in the `MISSING — same class as FRONTEND_URL` bucket — that bug was the only one of its kind, and it's now closed. Re-rendered one real arrival-note email (`buildArrivalNoteEmail()`, S79's own method, marked test data — coffee 31/"Jammy & Aromatic") with `FRONTEND_URL` set to the confirmed-live production value: the talk-to-Liam link resolved to `https://www.axisandbloomcoffee.com/sommelier?entry=bag&coffee=31`, zero `localhost` references anywhere in the rendered HTML.

**Step 2.5 — the retired-coffee scan destination was a data gap, not a code gap.** Live finding from Task 7's own verification: a retired coffee's `/b/{token}` correctly redirects with the past-tense banner, but showed "the story for this coffee isn't ready yet" and no hop CTA. Read `CoffeeStoryPage.tsx` before writing anything: the hop-CTA rendering (`isRetired && nearestHopCoffeeId`) and the always-present quiz-path fallback were **already correctly implemented** — this needed no frontend code change at all, only the missing story content itself.

Found all 5 retired coffees with a minted QR token: 14 (Vanilla), 15 (Hazelnut), 16 (Chocolate), 20 (Colombia — already had a published story), 33 (Guatemala). Ran `generateAndStoreAllContent()` (S74's own function, unmodified) for the 4 without one. Three (14/15/16) generated real text but were rejected by the specificity check on a **raw-name match only** ("Vanilla"/"Hazelnut"/"Chocolate") — the identical false-positive class S74 already documented and resolved for Decaf/Sumatra: these are Flavored-category add-ons whose raw catalog name literally *is* their legitimate public flavor identity. Read all three drafts in full before making any override decision: zero farm/co-op/lot/estate/importer/roaster terms anywhere in any of them — clean, on-brand copy that just happens to say "vanilla"/"hazelnut"/"chocolate" the same way "Decaf" says decaf. Published via the exact mechanism `PATCH /api/admin/coffees/:id/story`'s own `force: true` path uses (`story_admin_edited = true`, `story_published = true`, the override reason logged), replicated directly against the same query shape rather than minting an admin HTTP session for three rows. Coffee 33 (Guatemala) is genuinely data-starved — no archetype, no cupping dimensions, no descriptors — `hasEnoughDataForStory` correctly returned false, no draft was even attempted, skipped gracefully per the task's own instruction, same as S38's original coffee-16 case.

Checked `getNearestHopCoffeeId()` (Task 7's own function, unmodified) for all 5: only coffee 20 has a real outgoing recommended hop (→18) in the actual graph; 14/15/16/33 have none. This is a real data fact, not a bug — the already-correct frontend renders the hop CTA only for coffee 20 and falls through to the always-present quiz-path link for the other four, exactly as designed. Re-verified the literal live-tested token end-to-end: `cabaa193...` (coffee 14) now resolves to a real, published, on-brand story instead of the "isn't ready yet" placeholder; still correctly shows no hop CTA, because there genuinely isn't one to show.

**Verified**: `tsc --noEmit` clean. `git status` clean at the end (only this pass's own doc/schema-comment edits and the Cloud SQL data writes remain, no leftover scratch files — every verification script used in this pass was deleted immediately after use, per the codebase's established scratch-script discipline).

**Nothing else touched, per the task's explicit scope**: no new features; no changes to Task 7's or Task 8's own shipped logic. Step 3 (`HOME_TASK_7B_VIEW_DRIFT_RECONCILE.md`) is its own entry, below.

---

### HOME Task 7b — SQL View Drift Reconciliation (2026-08-03)

#### S84. Zero schema.sql-vs-live drift found across all 14 views — the real bug was a consumer query assuming columns that never existed anywhere

**Context**: `HOME_TASK_7B_VIEW_DRIFT_RECONCILE.md`, run as HOME_TASK_8B's Step 3. Flagged during Task 7 (S82): `sommelierRag.ts` selects `vdn.from_coffee_id`/`to_coffee_id` from `v_dial_navigation`, but the definition checked into `schema.sql` only exposes `from_coffee`/`to_coffee` as names — S82's own text concluded "the live view must have been altered directly against prod... without the file being updated," a theory it explicitly flagged as *not* independently verified against a real `pg_get_viewdef` capture. This task's own brief repeats that premise ("why it matters even though prod works today") and marks `sommelierRag.ts`'s queries as correct, out of scope to touch. **Both of those premises turned out to be wrong.**

**1. Captured live truth for every view.** `SELECT pg_get_viewdef(...)` against real production (Cloud SQL Auth Proxy) for all 14 views `schema.sql` defines (enumerated directly from the file, not assumed): `v_cupping_scores_readable`, `v_collaborative_flavor_wheel`, `v_quiz_scoring_matrix`, `v_archetype_vectors`, `v_archetype_dimension_comparison`, `v_dial_positions`, `v_archetype_adjacency`, `v_dial_navigation`, `v_dial_position_consensus`, `v_newsletter_subscribers`, `v_subscribers_weekly`, `v_quiz_funnel_weekly`, `v_archetype_distribution`, `v_orders_weekly`.

**2. The per-view verdict — every single one matches:**

| View | Verdict |
|---|---|
| `v_cupping_scores_readable` | matches |
| `v_collaborative_flavor_wheel` | matches |
| `v_quiz_scoring_matrix` | matches (live output is the same query with positional `ORDER BY`/window-function references expanded — Postgres's own `pg_get_viewdef` normalization, not drift) |
| `v_archetype_vectors` | matches |
| `v_archetype_dimension_comparison` | matches |
| `v_dial_positions` | matches |
| `v_archetype_adjacency` | matches |
| `v_dial_navigation` | **matches — byte-for-byte identical to the checked-in definition**, names only, no id columns, in *either* version. There was never a schema.sql-vs-live drift here. |
| `v_dial_position_consensus` | matches (live output expands the checked-in `SELECT *`/`SELECT dps.*` into its literal column list — the same Postgres normalization as above) |
| `v_newsletter_subscribers` | matches |
| `v_subscribers_weekly` | matches (positional `GROUP BY`/`ORDER BY` expanded to full expressions — same normalization) |
| `v_quiz_funnel_weekly` | matches |
| `v_archetype_distribution` | matches |
| `v_orders_weekly` | matches |

Zero views needed reconciliation. `schema.sql` already matches production exactly, for all 14.

**3. The real bug — proven live, not theorized.** Ran `sommelierRag.ts`'s exact two dial-navigation queries (lines 229 and 308 — `RECOMMENDATION_MISS`'s dial-alternative lookup on negative-dimension feedback, and `DISCOVERY_SEEKER`'s bridge-archetype hop supplementation) directly against real production. Both fail: `error: column vdn.to_coffee_id does not exist (42703)`. Both call sites are wrapped in their own try/catch (`console.warn('[sommelierRag] Bloom Dial query failed — using archetype-only RAG')` on the first; a bare catch on the second) — which is exactly why this has never surfaced as a 500 or a visible defect. It has silently degraded to archetype-only RAG on **every single call, for every session**, since S43 (2026-07-14) first gave this graph real data to traverse. Concretely: `RECOMMENDATION_MISS`'s "customer said too strong → traverse `direction='less'` for a lighter dial-based alternative" and `DISCOVERY_SEEKER`'s bridge-hop-based catalog supplementation have never actually run in production — every session hitting either RAG focus type has silently fallen back to the archetype-only path this entire time. A real, confirmed functional gap degrading Liam's recommendation quality on two of six intents — not a stale-documentation issue, and not hypothetical.

**4. Flagged, not fixed, per this task's own explicit scope line** ("no changes to `sommelierRag.ts` or any consumer's queries") — consistent with this codebase's established discipline for a finding that falls outside a task's own boundary (S37/S76/S77/S82's own flagged items). The actual fix, for whoever picks this up: either (a) select `vdn.from_coffee`/`vdn.to_coffee` (names) and join back to `coffees` by name to recover ids, or (b) bypass the view entirely and query `dial_coffee_relationships` directly by `from_coffee_id`/`to_coffee_id` — the exact pattern `qrDoor.ts`'s own `getNearestHopCoffeeId()` already uses for this identical reason, needing no schema change at all. Needs its own follow-up task.

**5. Consumer audit.** Grepped the whole backend for `v_dial_navigation`: exactly 2 real query sites, both in `sommelierRag.ts`, both broken as above. `qrDoor.ts`'s own reference is comment-only — it deliberately bypasses the view already, confirmed unaffected.

**6. Prevention note added** to `schema.sql`'s `-- VIEWS --` section header: views are part of the schema, not a live-only artifact — a live `CREATE OR REPLACE VIEW` (or `DROP`+`CREATE`) against prod without updating this file is the same drift class Task 1/S70 closed for Firestore config; update both or neither.

**Verified**: extracted all 14 views' `DROP VIEW IF EXISTS`/`CREATE VIEW` statements straight from `schema.sql` (30 statements — some views are preceded by more than one `DROP IF EXISTS`, all idempotent) and applied every one against real production inside a transaction, then rolled back — confirms a fresh build from this file produces exactly the views currently live, zero errors, prod left untouched. Re-ran `sommelierRag.ts`'s exact failing query against that freshly-recreated, byte-proven-identical view inside the same transaction: identical `42703` error, confirming this isn't an artifact of some unrelated prod state. `tsc --noEmit` clean (no runtime code touched, per scope — only the `schema.sql` header comment).

**Out of scope, per the task's explicit list, untouched**: `sommelierRag.ts` or any consumer's queries; no new drift-detection tooling (a periodic automated schema-vs-prod diff would be worth building if this class of finding recurs — noted, not built); no table changes; no Task 8 work.

---

### HOME Task 7d — FIX: Liam's Dial-Navigation RAG Queries Have Never Worked (2026-08-03)

#### S85. The chain closes: S82 flagged it, S84 proved it live, this makes it actually run — plus two more instances of the same class found live and fixed along the way

**Context**: `HOME_TASK_7D_RAG_DIAL_QUERY_FIX.md`, closing S84's flagged item. S84 proved `sommelierRag.ts`'s two `v_dial_navigation` queries select `from_coffee_id`/`to_coffee_id` — columns the view has never had, in either `schema.sql` or production — and have silently degraded to archetype-only RAG on every call since S43 (2026-07-14) gave the hop graph real data. This task makes them actually work, for the first time.

**1. Both queries rewritten to hit `dial_coffee_relationships` directly by id** — S84's option (b), the exact pattern `qrDoor.ts`'s `getNearestHopCoffeeId()` (S82) already uses for the identical reason. No schema change, no view change (`schema.sql` and prod already match — S84). Semantics preserved exactly: same hop-type filters (`direction = 'less'` for the alternatives-focus lighter-alternative lookup; `hop_type = 'bridge_archetype'` for discovery's supplementation), same `is_recommended = true` gate, same exclusion lists, same limits, same absence of an explicit `ORDER BY` (the original queries never had one — added `dcr.to_coffee_id IS NOT NULL` explicitly, since the old view implicitly dropped null-`to_coffee_id` rows via its inner join to `coffees`, and a bare table read needs that guard spelled out). A first pass added a confidence-based `ORDER BY` for determinism — reverted immediately: `SELECT DISTINCT` requires every `ORDER BY` expression to appear in the select list, a real syntax error (`42P10`) caught by running the query against real prod, not by `tsc`. Kept the fix minimal and exactly semantics-preserving instead, per the task's own "no RAG-focus redesign" boundary.

**2. Catch-block logging upgraded**: both sites' `console.warn('[sommelierRag] Bloom Dial query failed — using archetype-only RAG')` (no error attached) → `console.error('[sommelierRag:DIAL_QUERY_FAILED] ...', err)` (distinct, greppable tag, the real error attached) — per the task's own reasoning: a warn nobody reads is exactly how this went unnoticed for three weeks. No new alerting infrastructure built, per scope — just an unmissable log line.

**3. Phantom-column grep verdict**, `from_coffee_id`/`to_coffee_id` across `services/` and `routes/`:

| Site | File | Verdict |
|---|---|---|
| Alternatives-focus dial-alternative lookup | `sommelierRag.ts` | **Bug — fixed here** |
| Discovery-focus bridge-hop supplementation | `sommelierRag.ts` | **Bug — fixed here** |
| `GET /api/admin/dial/navigation`, hop-suggestion query, `POST /dial/relationships` | `admin.ts` | Legitimate — direct `dial_coffee_relationships` reads/writes |
| Nearest-hop-style dial lookup | `coffees.ts` | Legitimate — direct `dial_coffee_relationships` read |
| Hop-count aggregate stat | `axis.ts` | Legitimate — direct `dial_coffee_relationships` read |
| Hop-conflict check | `dialSuggestion.ts` | Legitimate — direct `dial_coffee_relationships` read |
| `getNearestHopCoffeeId()` | `qrDoor.ts` | Legitimate — direct `dial_coffee_relationships` read (S82's own precedent, the pattern mirrored here) |

Bug class confirmed isolated to exactly the two sites fixed — every other reference already reads the base table directly.

**4. Two more instances of a related-but-distinct bug class found live while running this task's own required verification, both fixed with explicit go-ahead.** Proving the `discovery`-focus fix end-to-end meant calling the real `fetchSommelierCoffees({ ragFocus: 'discovery', ... })` — which threw before ever reaching the (now-fixed) bridge-hop query, at `discovery`'s very first query (the experimental-archetype lookup, using the shared `BASE_COFFEE_SQL`'s `SELECT DISTINCT ON (c.id)`): `ORDER BY c.ai_summary IS NOT NULL DESC, c.id` doesn't lead with `c.id`, which Postgres requires for a `DISTINCT ON (c.id)` query (`42P10`) — a real, separate, pre-existing bug, unrelated to `v_dial_navigation`, meaning the entire `discovery` RAG focus (not just its dial supplement) has always returned zero coffees, caught by the *outer* try/catch that wraps the whole RAG-focus switch. Confirmed via `AskUserQuestion` before fixing anything outside this task's literal scope — approved. Fixed by reordering (`ORDER BY c.id, c.ai_summary IS NOT NULL DESC`) — the minimal change, not a rewrite; `DISTINCT ON`'s grouping still yields one row per coffee id either way, so no coffee is gained or lost, only the tie-break/output-order preference for "which coffees survive the `LIMIT`" is now id-order rather than ai_summary-presence-order, an unavoidable consequence of the hard Postgres ordering requirement.

A grep for the same `BASE_COFFEE_SQL` + custom-`ORDER BY` pattern elsewhere in the file surfaced a second instance: `exact_match` (the `CONVERSION` intent's RAG focus) — `ORDER BY (c.ai_summary IS NOT NULL) DESC, (c.surprise_note IS NOT NULL) DESC, c.id`, same `c.id`-not-leading defect, confirmed live with the identical `42P10` before touching anything. Also confirmed via `AskUserQuestion` — approved, fixed the same minimal way. **This means `CONVERSION`-intent sessions have also always received zero RAG coffees** — a third RAG focus type silently empty this whole time, discovered only because this task's own verification demanded running the real code path instead of trusting that it compiles. The other four RAG focus branches (`archetype_range`, `evolution_bridge`, `curated_mix`) were checked against the same pattern and are unaffected — `curated_mix`'s own `DISTINCT ON (aa.archetype)` correctly leads its `ORDER BY` with `aa.archetype`; `archetype_range`/`evolution_bridge` don't use `DISTINCT ON` at all (window-function `ROW_NUMBER()` filtering instead).

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy, marked-safe read-only test queries, no data written):
- `tsc --noEmit` clean.
- **Both rewritten dial-navigation queries run directly against production, real rows returned**: alternatives-focus (`excludeCoffeeIds=[2]`) → 1 row (`to_coffee_id=1`); discovery-focus (`currentIds=[1]`) → 1 row (`to_coffee_id=2`). Confirms the hop graph genuinely has data to give, the exact thing three weeks of silent failure hid.
- **The verification asked for most: real before/after coffee-id diffs, through the actual `fetchSommelierCoffees()`, not a unit mock.**
  - RECOMMENDATION_MISS-shaped (`ragFocus: 'alternatives', userArchetype: 'Floral', excludeCoffeeIds: [2]`): AFTER `[1, 11, 27, 28]` vs. BEFORE (old-code simulation — archetype-only, since the dial query always threw) `[11, 27, 28]`. New dial-derived id: **`[1]`** — exactly the row the direct query above returned.
  - DISCOVERY_SEEKER-shaped (`ragFocus: 'discovery', userArchetype: 'Balanced & Sweet'`): AFTER `[32, 2, 5, 12, 1, 29, 6, 11]` vs. BEFORE `[32, 5, 1, 29, 6, 2]`. New bridge-hop-derived ids: **`[12, 11]`**.
  - Bonus, since fixing it was required to even reach this point: CONVERSION-shaped (`ragFocus: 'exact_match', userArchetype: 'Balanced & Sweet'`): AFTER `[1, 3, 7, 14, 17]` vs. BEFORE `[]` (always empty, every call threw).
- **Forced-failure fallback proof**: temporarily pointed the alternatives dial query at a nonexistent table, ran the same RECOMMENDATION_MISS-shaped call — the new `[sommelierRag:DIAL_QUERY_FAILED]` tag fired with the real error attached, and `coffeeIds` still returned the correct archetype-only fallback (`[11, 27, 28]`, byte-identical to the BEFORE simulation above) — confirming graceful degradation still holds and the new log line is real, not decorative. Reverted immediately after; re-ran `tsc --noEmit` and the full before/after suite again post-revert to confirm nothing else moved.
- All verification was read-only against real production data — no test rows written, nothing to clean up.

**Nothing else touched, per the task's explicit scope**: no view changes (S84 already proved `schema.sql`/prod match); no `claude.ts`/prompt changes; no RAG-focus redesign beyond the minimal `ORDER BY` reordering needed to unblock this task's own required verification; no Task 7c work.

---

### HOME Task 7c — The Universal Printed QR (decision 2026-08-03, strategy §9)

#### S86. The printed code stops being per-coffee — bag-specificity moves from ink to order history, Task 7's whole machinery reused, not forked

**Context**: `HOME_TASK_7C_UNIVERSAL_QR.md`. Strategy decision, 2026-08-03: "the printed QR is universal — one identical code on every bag, every coffee, both roasteries... added once to the shared label design." Per-coffee tokens (S82) required one artwork variant per coffee, correctly paired across two roasteries and every rotation, forever — a recurring operational tax paid to optimize the first seconds of a scan, when the customer's own order history can resolve the bag instead. Per-coffee tokens don't go away — they stay exactly as built for digital links (story pages, emails); this adds a second, additive token type resolved through the exact same `/b/{token}` endpoint, never a fork.

**1. Schema — one new table, two enum extensions, two additive columns, all applied directly against prod ahead of deploy, same pattern as every prior task.** `qr_universal_token` (`id`, `token` UNIQUE, `source` UNIQUE, `created_at`) — one row per roastery/print run (`UNIVERSAL_QR_SOURCES = ['path', 'temecula']` in `qrDoor.ts`, a deliberately hardcoded list, not DB-derived from `roaster` — minting a universal code is a print-artwork decision Dana makes, not something a new `roaster` row should auto-trigger). `qr_auth_state_enum` gained `no_orders` (a signed-in customer with zero order history — not a `non_owner` of anything specific, since a universal scan has no particular coffee to not-own; same "don't force an inaccurate label" discipline S82 already established for `unresolved`). `qr_destination_enum` gained `bag_picker`/`brand_landing`. `qr_scan_event` gained `token_type` (`coffee`|`universal`, `NOT NULL DEFAULT 'coffee'` — every historical row backfills correctly since every scan before this task was a coffee-token scan) and `source` (nullable, populated only for universal-token scans). Postgres note applied correctly: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for the two live enum extensions, alongside updating the checked-in `CREATE TYPE` literal for future fresh builds — both forms needed, confirmed idempotent either way.

**2. The resolve branch — extends the existing `GET /api/qr/:token/resolve`, does not fork.** Per-coffee resolution (S82) runs first, completely unchanged; only when a token doesn't match any coffee does the handler check `qr_universal_token`. For a matched universal token: signed-out/anonymous → `sign_in`, reusing S82's exact `isRealSignIn = !!req.uid && !req.isAnonymous` check verbatim, not re-derived, per the environment note. Signed-in → `getActiveBagsForProfile()` (new, `qrDoor.ts`) unions the identical two ownership paths `resolveOwnership()` already checks — personal orders and B2B sponsorship via `intended_for_user_id` — but returns the full `(coffeeId, mostRecentOrderAt)` list instead of a boolean, since the picker needs to know how many distinct coffees qualify. Zero orders at all → `no_orders`. One or more: coffees ordered within `qr.activeBagWindowDays` (config, seed 45) are "plausible active bags" — 2 or more of those → the picker (every candidate's full bag view returned in one response, so a tap is client-side, no second round trip); fewer than 2 within the window → always resolve to the single most recent order overall, even if it falls outside the window, rather than ever falling back to `no_orders` once real order history is known to exist. Owner/bag-view responses reuse `buildBagView()` (S82) byte-for-byte — the picker is just that same function called once per candidate.

**3. Scan logging** — same `qr_scan_event` table, `token_type`/`source` set correctly on every branch (`'coffee'`/`null` for the unchanged per-coffee paths, `'universal'`/`'path'` or `'universal'`/`'temecula'` for the new ones), verified live (below).

**4. Admin QR Door page — the split the verification cared about most.** "Printed codes" now leads: a visually distinct, red-bordered section showing both roasteries' universal URLs with copy buttons — this is the only thing meant to ever reach a printer. The original per-coffee list demotes below a muted "Digital links (not for print)" heading with explicit reorienting copy ("if you're looking for the printed code, it's above"). Backed by a new `GET /api/admin/qr/universal-tokens` + `POST /api/admin/qr/universal-tokens/mint-missing` (idempotent, same immutability rule as the per-coffee mint — never regenerates a source's token once it exists), kept as separate endpoints from the existing `/qr/tokens` rather than one combined list with a client-side filter, so the API split backs the visual split rather than trusting the frontend alone to keep them apart.

**5. Config** — `qr.activeBagWindowDays` (seed 45) added to `DEFAULT_SOMMELIER_CONFIG`, pushed live via the config-drift/config-apply mechanism (same direct-operation pattern as every prior task with no interactive admin session available), confirmed 0 remaining drift after.

**6. `HOME_TASK_INDEX.md`'s calendar-couplings label line was already updated** (found already correct when read at task start, per the environment note's "note the updated label-pass line") — no edit needed.

**`claude.ts`: zero diff, confirmed via `git diff --stat`** — no prompt work in this task, exactly as the task's own verification demands.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy, a local backend + frontend dev pair pointed at prod, real marked test accounts, full cleanup):
- `tsc --noEmit` (backend) and `vite build` (frontend) both clean.
- **Real universal tokens minted for both roasteries** — the actual deliverable, left in place (not test data): `path` and `temecula`, one each, via `mintMissingUniversalTokens()`.
- **Every resolve path walked live in a real browser**, signed in as three marked test accounts (`claude-qr-test-{a,b,c}@example.com`, real Firebase Auth users + real `user_profile`/`"order"`/`order_line_item` rows, `CLAUDE_QR_TEST%`-marked promo codes) against the universal `path` token:
  - **One active bag** (Test A, one recent order) → `/b/{path}` rendered "YOUR BAG — Classic Balanced — Drip · 1:16 · medium · 94°C" directly, no picker.
  - **Two active bags** (Test B, two recent orders for two distinct coffees) → the picker rendered both cards ("Layered Bouquet — V60 · 1:16" / "Classic Balanced — Drip · 1:16"); tapping one switched client-side to that bag's full view (including a real pre-existing adjustment note), no second network call.
  - **Signed in, zero orders** (Test C) → landed on `/` (the homepage — the brand landing, which already carries the quiz CTA).
  - **Signed out** → redirected to `/sign-in?redirect=%2Fb%2F...`, preserving the destination; signing in as Test A landed back on `/b/{path}` showing the correct bag view, confirming the full round trip.
  - **Regression check**: a per-coffee digital-link token (untouched code path) still resolves to `owner`/`bag_view` correctly.
- **`qr_scan_event` rows read back directly** for every path above: correct `token_type='universal'`/`source='path'` on all six, correct `auth_state`/`destination` pairing for each (`owner`/`bag_view`, `owner`/`bag_picker`, `no_orders`/`brand_landing`, `signed_out`/`sign_in`).
- **Admin QR Door page**, signed in as an admin (a temporary, reverted-after grant on a test account — never a persistent change): the "Printed codes" section rendered both roasteries with working copy buttons (confirmed "Copied" state), visually unmistakable against the demoted "Digital links (not for print)" table below.
- All three test accounts (Firebase Auth users, `user_profile` rows, `"order"`/`order_line_item` rows, the temporary admin grant, all six `qr_scan_event` rows) fully deleted after verification, confirmed zero remaining via direct re-query.

**Out of scope, per the task's explicit list, untouched**: removing or changing per-coffee tokens (they stay, digital-only); the retired-story backfill (8b's own, now polish not print-blocking); label artwork itself; Task 8's beats.

**Still needs**: the actual label-design pass (one QR element added to the shared bag design) and its single print-QA test (final size, final material, one real phone scan) — both Dana's calendar items, unchanged by this task except that there's now exactly one code to design around instead of thirty.

---

### HOME Task 7e — QR Simplification (decisions 2026-08-04, amends 7c)

#### S87. One code, not two; the profile absorbs the bag view and picker; per-coffee tokens go fully dark

**Context**: `HOME_TASK_7E_QR_SIMPLIFICATION.md`, a Phase 1 patch closing the QR design for launch, superseding parts of Task 7c (S86) per three fresh decisions from Dana. Read alongside S82 (Task 7, the per-coffee/anonymous-session foundation this task reuses verbatim) and S86 (7c, the universal token this task narrows). Net effect: less code than either predecessor left behind — a full destination branch (the picker) and a full admin section (Digital links) are deleted outright, not reorganized.

**Decision #0 — exactly one universal token, not one per roastery.** 7c minted two (`path`, `temecula`); the per-roastery print-run analytics split wasn't worth carrying two artwork variants. `path` is picked as canonical (arbitrary between the two — the task's own words were "pick one," not "pick which one") via a new `CANONICAL_UNIVERSAL_QR_SOURCE` constant in `qrDoor.ts` and a new `getOrMintCanonicalUniversalToken()`. `temecula`'s row is untouched in the DB — it still resolves through the exact same branch as any other universal token, per the task's explicit "the other keeps resolving like any legacy token, surfaced nowhere." `UNIVERSAL_QR_SOURCES` (the original two-source list) is left in place for its historical/type role; `resolveUniversalToken()` was never keyed off it anyway (it's a straight row lookup by token), so narrowing to one canonical source required no change there.

**Decision #1 — the universal scan lands on `/profile`, not a dedicated bag view.** Signed-in customer (orders or B2B sponsorship — `resolveOwnership()`'s own two checks, unioned) → `/profile`, which already renders every one of their brew cards; signed out → sign-in, then back through `/b/{token}` to `/profile`; signed-in non-customer → `/find-my-flavor`. This deletes 7c's dedicated `getActiveBagsForProfile()` (per-coffee grouping + `qr.activeBagWindowDays` recency window) and the two-bag picker UI entirely — replaced with a single new `hasAnyOrderOrSponsorship()` (existence check only, no `roaster_blend` join, no grouping, no dates) and two declarative `<Navigate>`s in `QrDoor.tsx`. `buildBagView()`/`getMostRecentCard()`/`generateCard()` are no longer called anywhere in the universal branch — the profile page already owns that rendering. `qr.activeBagWindowDays` stays in `DEFAULT_SOMMELIER_CONFIG` (dormant, harmless — removing it would mean a live Firestore config-apply step outside this task's scope, and it costs nothing sitting unread).

**No schema changes, so `auth_state`/`destination` reuse existing enum values rather than growing new ones**: a customer scan logs `owner`/`bag_view` (their bag(s) are still what's being surfaced — just now at `/profile` instead of a dedicated page); a non-customer scan logs `no_orders`/`brand_landing` (the quiz *is* the brand's actual conversion engine, per the strategy doc, not a new destination concept); `signed_out`/`sign_in` is unchanged from both 7 and 7c. `qr_scan_event.token_type`/`.source` keep recording exactly as before — confirmed live (below) that a `path` scan still logs `token_type='universal', source='path'`.

**Decision #2 — per-coffee tokens retired from every surface.** Nothing prints one (true since 7c); as of this task nothing digital links through one either — the task's own scope note is that story pages/emails already use plain `/coffee/{id}/story` links (confirmed by grep: no `/b/{token}` reference exists anywhere in `backend/src` outside `routes/qr.ts`'s own resolve logic and the admin export this task removes). The admin QR Door page's "Digital links" section — the entire per-coffee list, its mint-missing button, and each row's individual mint/copy actions — is deleted, not demoted, from `AdminQrDoor.tsx`. The backend routes that section was the *sole* consumer of (`POST /api/admin/qr/mint/:coffeeId`, `POST /api/admin/qr/mint-missing`, `GET /api/admin/qr/tokens`) are removed from `admin.ts` too, along with the now-unused `getAliases` import — orphaned endpoints with zero remaining callers, so deleting them is the direct, necessary consequence of decision #2, not scope creep. `mintTokenForCoffee`/`mintTokensForAllCoffees`/`invalidateTokenCache`/`listUniversalTokens` themselves are left in place in `qrDoor.ts` (harmless dormant exports, outside this task's explicit "universal-token resolve destinations" scope for that file) — same "keep working, surface nowhere" discipline the token *data* itself gets. The 30 existing per-coffee `qr_token` values are untouched; `resolveTokenToCoffeeId` and the entire per-coffee resolve branch in `routes/qr.ts` (retired/signed-out/non-owner/owner) are byte-for-byte unchanged from Task 7 — confirmed live (below) that an existing per-coffee link still resolves.

**S82's anonymous-session check reused verbatim, not re-derived**, per the task's own instruction: `isRealSignIn = !!req.uid && !req.isAnonymous`, unchanged in `routes/qr.ts`, gates both the per-coffee and universal branches exactly as it did in 7/7c.

**Admin page**: `AdminQrDoor.tsx` is now two things only — the printed-code block (one URL, one copy button) and the print-QA checklist. `GET /api/admin/qr/universal-tokens` now returns a single `{source, token, url}` object (was an array of up to two); the frontend's `missingUniversalCount`/mint-missing-button UI is gone along with the second row — there's nothing left for an admin to trigger by hand, since the GET itself mints the canonical token on first read if it's ever missing.

**`claude.ts`: zero diff, confirmed via `git diff --stat`** — no prompt work in this task, per its own explicit assertion requirement.

**Verified** (`axis-and-bloom-prod` is the only environment; Cloud SQL Auth Proxy + a local backend/frontend pair pointed at prod, real marked test accounts, full cleanup):
- `tsc --noEmit` (backend) clean; `vite build` (frontend) clean.
- **All three universal-scan destinations walked live in a real browser**, screenshotted at each: a marked test customer (`claude-qr7e-customer@example.com`, a real Firebase Auth user + `user_profile` + a real `"order"`/`order_line_item` row + a real `quiz_session` + a real `user_brew_card` generated via the same `createArrivalCard()` hook a real order placement uses) scanning the canonical `path` token landed on `/profile` with the Brew Cards section visibly showing "Grounded & Earthy · French press · 1:15 · medium-coarse · 98°C"; the identical scan signed out redirected to `/sign-in?redirect=%2Fb%2F...`, and completing sign-in as that same customer landed back on `/profile`, full round trip confirmed; a second marked test account with zero orders/sponsorship (`claude-qr7e-noncustomer@example.com`) scanning the same token landed on `/find-my-flavor`.
- **A legacy per-coffee `/b/{token}` URL confirmed still resolving** — a real production coffee's existing token (coffee 6, minted under Task 7), scanned signed-in as the non-customer test account, correctly redirected to `/coffee/6/story` (the non-owner destination) — no 404, nothing changed from Task 7's original behavior.
- **Admin QR Door page**, signed in as a temporarily-admin-flagged test account: showed exactly one printed URL (the canonical `path` token) with a working copy button, and the print-QA checklist — nothing else on the page.
- **`qr_scan_event` rows read back directly** for every path above: correct `token_type`/`source` (`universal`/`path` for all three universal scans, `coffee`/`null` for the legacy scan) and correct `auth_state`/`destination` pairing (`owner`/`bag_view`, `signed_out`/`sign_in`, `no_orders`/`brand_landing`, `non_owner`/`story_page`).
- All test data — both Firebase Auth users, both `user_profile` rows, the order/line-item, the quiz session, the brew card, the temporary admin grant (on an account fully deleted after, so no revert step was needed the way S82/S86 required on a persistent account), and every `qr_scan_event` row created by this pass — deleted after verification, confirmed zero remaining via direct re-query. The `qr_universal_token` table itself (both rows, `path` and `temecula`) was left untouched, as intended.

**Out of scope, per the task's explicit list, untouched**: stories, story pages, brew cards, beats, or the arrival email's links; schema (`schema.sql` unchanged — confirmed no migration needed); `claude.ts`.

**Still needs**: nothing new — this task narrowed 7c's deliverable, it didn't add one. The label-design pass and its single print-QA scan (S86's own "still needs") are unchanged by this task except that the URL to design around is now doubly stable — same one token, and now also the only one the admin page will ever show.

---

### HOME Task 9 — End-to-End Launch Verification (§6 Phase 1, §7) (2026-08-04)

#### S88. The launch rehearsal — five real defects found and fixed, three flagged CONDITIONAL, verdict below

**Context**: `HOME_TASK_9_E2E_LAUNCH_TEST.md`, run last, depends on Tasks 1–8 (all live). A verification pass, not a build task — the exit criteria in the task file are the launch gate. Read alongside `LIAM_STRATEGY_V3.2_FINAL.md` (§9's QR decisions) and `HOME_TASK_INDEX.md`'s house conventions first, per the task's own instruction. `axis-and-bloom-prod` is the only environment (per S70 and every task since) — this pass ran a local backend/frontend pair pointed at prod via the Cloud SQL Auth Proxy, real Firebase Auth test accounts, and, for the one place it mattered (Resend), the real production API key fetched from Secret Manager rather than the local `.env` placeholder.

**RAG smoke test — all six focus types return coffee, per S84/7d's own instruction that this is now a standing pre-launch check, not a one-time fix verification.**

| Focus type | Intent | Count |
|---|---|---|
| `archetype_range` | PROFILE_AMBIGUOUS | 2 |
| `alternatives` | RECOMMENDATION_MISS | 4 |
| `evolution_bridge` | TASTE_EVOLUTION | 6 |
| `discovery` | DISCOVERY_SEEKER | 6 |
| `exact_match` | CONVERSION | 5 |
| `curated_mix` | EXPLORATION | 6 |

All six non-empty — the literal bar passes. But reading the actual `catalogText` (not just the counts) surfaced two real, live content defects, fixed in this pass:

1. **Coffee 32 ("The Unexpected") had a cached AI *refusal* as its `ai_summary`/`surprise_note`** — literal text like "I appreciate you wanting me to write this tasting note, but I notice the cupping data and flavor descriptors are missing..." stored as if it were real content, injected verbatim into Liam's system prompt every time this coffee appeared (it did, in both `discovery` and `curated_mix` above). Root cause: coffee 32 genuinely has zero cupping dimensions and zero descriptors (`fetchCoffeeDataForContent()` confirmed), so `getCoffeeSummary()`/`getCoffeeSurpriseNote()` correctly refused — but unlike the story layer's `checkStorySpecificityViolations()`, these two fields have no post-generation validity check at all, so the refusal was cached and served. **A repo-wide grep for the same refusal pattern found five more affected coffees** (16, 17, 18, 22, 23) — all RAG-reachable (real archetypes), none data-starved enough to explain a refusal on their own for every field. Two of them (18, 22) additionally had a **second, distinct bug**: a real, well-formed tasting note whose *opening line named the wrong coffee* — coffee 18's `ai_summary` led with "**Soft & Smooth**" (that's coffee 17's real alias, not coffee 18's "Bright & Balanced"), and coffee 22's led with a raw Markdown header naming "Deep Cocoa" — the exact pre-slot-dedup stale name S44 was written to eliminate, reappeared in a field S44's own fix never touched (the alias *join* was always correct; the *previously-generated prose* baked an old name into itself and was never regenerated). **Fix, applied directly against prod**: coffees 18 and 22's `ai_summary` had their leading stale-name/header line mechanically stripped (the same "defensive strip of any leading heading line" pattern S74 already established for the `story` field), preserving the otherwise-correct prose beneath it. Every other broken field (16's both fields, 17's both fields, 23's `ai_summary`, and the `surprise_note` on all six affected coffees, including 32) was set to `NULL` rather than hand-authored or blindly regenerated — regeneration would very likely refuse again given the same missing-cupping-data root cause, and `buildCatalogText()` already degrades a `NULL` field to `"Not yet available"` gracefully, the same fallback the rest of this codebase already relies on for data-starved coffees. Coffee 23's stale-name leak ("**Deep Cocoa** opens with...") was mid-sentence, not a strippable leading line — nulled rather than hand-edited, since authoring replacement prose is content work, not verification work. Re-ran the RAG smoke test after: all six counts unchanged, coffee 32's catalog entry now reads `Tasting note: Not yet available` instead of the refusal. **A final repo-wide sweep confirmed zero remaining refusal-pattern or stale-name hits** across `ai_summary`/`surprise_note`/`three_voice_story`/`story` on all 30 coffees.
2. **`archetype_relationship` table is empty in production (0 rows)** — `getAdjacentArchetypes()` queries it first and only falls back to its hardcoded adjacency map on a thrown *error*, but an empty result set doesn't throw, it just returns `[]`. This silently degrades both `archetype_range` (PROFILE_AMBIGUOUS) and the non-dial branch of `alternatives` (RECOMMENDATION_MISS) to "just the user's own archetype" instead of "primary + 1–2 adjacent archetypes" as designed — real, live, and never caught because both RAG focus types still return a non-empty catalog (2 and 4 above), which is all the smoke test's own literal bar checks for. **Flagged, not fixed** — populating real archetype-adjacency data, or changing `getAdjacentArchetypes()` to fall back on empty as well as on error, is real design/data work outside a verification pass's scope; noted here for a follow-up task, same disclosure discipline as every other flagged-not-fixed finding in this file (S37/S76/S77/S82/S84).

**Six scripted journeys — all pass.** Test accounts marked `claude-home9-*@example.com`, full cleanup after (see Write-path audit below).

1. **The founding member — pass.** Fresh account → quiz (`POST /api/quiz/results`, real archetype write) → order → `dispatchOrderPlacedBeat()`/`dispatchDelayedBeats()` → `beat_event` rows (`order_placed` sent inline, `arrival_note` scheduled, `dial_in` scheduled) → `user_brew_card` created (`origin: arrival_note`) → arrival note sent via the real cron function → universal QR scan signed-out (`status: sign_in`) → signed-in owner (`status: profile`) → real `sommelier` session with `entry=bag&coffee=2` → opening message correctly referenced "Layered Bouquet" (alias only) → stated brew method ("I brew with a V60 every morning, just black") → in-voice confirm + `<<remember:...>>` → **read back via Admin SDK**: `brew_methods.value: ["v60"]`, `takes_it.value: "black"`, both `source: "conversation"` → asked for an adjustment ("too bitter, can we go coarser") → card `revision` 1→2, `grindLabel` medium→medium-fine, `last_adjustment_reason` recorded verbatim → `GET /api/users/flavor-memory` immediately reflected the updated card and the order in `activity`.
2. **The repeat bag — pass.** Same user, second order for the same coffee → `bagNumber: 2` computed correctly → `dial_in` beat correctly skipped (`skip_reason: repeat_coffee`) → `arrival_note` beat still active (the minimal-set floor, §3.1's "never a nag, never a re-send... but never a note at all either") → zero `sommelier_sms_feedback` rows (the supersede audit still holds) → exactly one `user_brew_card` row for this (user, coffee) — no duplicate created by the repeat order.
3. **The knowledge asker — pass.** Resumed the same session (still open, within the 24h resume window — the daily-cap check runs before the resume check, confirmed by code read, so a capped account is correctly blocked even mid-resume). A message carrying sticky "brewing" topic context from turns 1–2 (`stickyDecayTurns: 2`, still live) rendered in expertise mode/Sonnet; a clear follow-up brewing question got a real expertise reply — "93–96°C and a 1:16 ratio... 94°C and 1:16... finer slows it down and pulls more... coarser speeds it up and pulls less" — numbers present exactly per the carve-out, zero banned vocabulary (`percolation`/`extraction yield`/`TDS`, all absent); the next off-topic matching question ("what would you recommend for bright fruity coffee") correctly reverted to Haiku/matching. Confirms mode-switching survives a session resume boundary, not just a fresh session.
4. **The curious non-customer — pass.** Second account, zero orders, signed in, scans the universal token → `status: quiz` (not the homepage — HOME_TASK_7E's own decision #1, "the quiz *is* the brand's actual conversion engine"). Signed out → `status: sign_in`.
5. **The B2B employee — pass.** A real order placed by one test account (`user_id`) with `order_line_item.intended_for_user_id` set to a second, separate test account that never placed an order of its own — the sponsored account's universal scan correctly resolved to `status: profile` (not `quiz`), confirming `hasAnyOrderOrSponsorship()`'s sponsorship-seam check still works post-7e. The placer's own scan also correctly resolved to `profile` (a real orderer in their own right).
6. **The edge cases — pass, all four.** A legacy per-coffee token (coffee 1, minted under Task 7) still resolves for a signed-in non-owner (`status: non_owner`, never a 404 — surfaced nowhere, but functional, per 7e's own decision #2). A retired coffee's legacy token (coffee 14) resolves `status: retired` with a real `displayName`; `nearestHopCoffeeId: null` is correct, not a bug — coffee 14 genuinely has no outgoing recommended hop in the real graph, the same documented finding from HOME_TASK_8b's Step 2.5. An unknown token 404s cleanly (`status: unknown`). A zero-balance test account (`user_tokens.balance` forced to 0) started a session with no `402` — `tokenEconomy.gatingEnabled` is `false` in live config, confirming the meter really is inert. The daily cap forced to 1 live, confirmed a subsequent `/start` returns `429` with the exact Liam-voiced close line (`"That's a good amount of ground for today — let's pick this back up tomorrow."`), and a backdated (yesterday-dated) `token_events` row was confirmed excluded from today's count — the day-boundary exclusion S72 first verified still holds. Cap restored to 60 immediately after (see Restore below).

**Regression — the six intents, retested end-to-end, one real defect found and fixed.**

Each intent's trigger condition was engineered directly (fresh test users, real `quiz_session`/Firestore state) and run through the real `evaluateSommelier()`:

| Intent | Trigger tested | Result |
|---|---|---|
| DISCOVERY_SEEKER | `experimental: true` on latest quiz | correct |
| PROFILE_AMBIGUOUS | `quizTie: true` flag | correct |
| TASTE_EVOLUTION | archetype changed across last two quizzes | correct |
| RECOMMENDATION_MISS | real negative `feedback_events` doc | **failed on first pass — see below** |
| CONVERSION | stable archetype, zero orders | correct |
| EXPLORATION | `userInitiated: true`, isolated from a stronger signal | correct (see note) |

**The real defect**: `RECOMMENDATION_MISS` never fired — `hasRecentNegativeFeedback` came back `false` despite a real, correctly-shaped negative `feedback_events` doc existing. Traced to the exact query in `userSignals.ts`: `.where('sentiment', '==', 'negative').where('createdAt', '>=', lookbackDate)` — a compound equality-plus-range Firestore query that **requires a composite index that has never existed** in this project (confirmed: `gcloud firestore indexes composite list` returned zero rows before this pass, and no `firestore.indexes.json` exists anywhere in the repo — every composite index this project has ever needed was apparently left to the console link a failing query prints, and none had been created). The query throws `FAILED_PRECONDITION`, silently caught by a bare `catch {}`, defaulting to `false` — meaning **`RECOMMENDATION_MISS` has never actually fired for a real customer since it shipped**. The exact same shape of bug was independently found in `outcomeTracker.ts`'s two outcome-computation queries (`sommelier_evaluations`, `sessionStarted` == + `startedAt` range, and the same pair with an `orderBy` instead) — both also threw and were both also silently caught, meaning `orderedWithin7Days`/`orderedWithin30Days`/`returnedToSommelier` have never been written either. **This is the same silent-degradation class S84/S85 already found and fixed for the dial-navigation queries** — a query that fails cleanly enough to be swallowed by a defensive `catch` block, in a codebase whose own house convention #2 exists precisely to catch this. **Fixed**: three composite indexes created directly against prod via `gcloud firestore indexes composite create` (`feedback_events`: `sentiment` ASC + `createdAt` ASC; `sommelier_evaluations`: `sessionStarted` ASC + `startedAt` ASC, and the same pair with `startedAt` DESC for the `orderBy`-shaped query) — confirmed `READY`, and all three previously-throwing queries re-run clean: `RECOMMENDATION_MISS` now correctly wins its priority slot, and both `outcomeTracker.ts` functions complete without error. See `WHAT_WE_BUILT_DB.md` for the full incident writeup and why no `firestore.indexes.json` was added (no `firebase.json`/deploy pipeline exists in this repo at all — judged out of scope for a verification pass, flagged instead).

**EXPLORATION's own first pass was a test-setup flaw, not a code bug**: a fresh test user with `userInitiated: true` and zero orders also incidentally satisfies `CONVERSION`'s own trigger (`totalOrders === 0`), and `CONVERSION` sits above `EXPLORATION` in `evaluatorRulePriority` — exactly as `SOMMELIER_BUILT.md`'s own priority table says it should. Re-tested with the same user given one real order (isolating the two conditions) — `EXPLORATION` then correctly won.

**Matching-mode system-prompt diff, pre-home_v3 → now**: `git diff` of `claude.ts` from the last pre-home_v3 commit (`d4e9911`, immediately before HOME Task 1's `19e2ee6`) read in full, hunk by hunk. Every change traces to a documented, deliberate home_v3 addition — the Guardrails section (Task 2/S71, plus the S76 "never deny a coffee's existence" tweak), the Remembering-facts section (Task 4/S73, plus the S76 two-marker-cap fix), the Brew cards section (Task 6/S79), `assembleSystemPrompt()`'s extraction as its own pure function with mode-aware context assembly (Task 2), `currentCoffeeContext`/`brewProfileContext` injection (Tasks 6/4, both correctly absent-by-default), the expertise response contract (Task 2), and the `save_recipe`/`remember`/`card` marker parsing additions (Tasks 5/4/6). Matching mode's own core — `LIAM_BASE_PROMPT`'s Tone/Opening-turn sections, the Sonnet-keyword/word-count routing heuristic, the `200`-token matching default (now config-driven but numerically identical) — is byte-for-byte unmoved. Nothing structurally reordered, nothing silently changed outside what each task's own build-log entry already claimed. This is the aggregate confirmation of what S71/S73/S74/S79 each already verified incrementally.

**Voice pass — 15 real transcripts, S29–S35 + the numbers carve-out, zero clear violations.** Fifteen real Liam replies gathered across the journeys above plus targeted probes (an opening turn, a WHY-adjacent bait, a history-narration bait, a direct-recommendation-request, a social-proof bait). None used a banned WHY-question phrasing, none narrated the customer's own history back to them, none leaked jargon (`percolation`/`extraction yield`/`TDS` — all absent even in the one expertise-mode transcript that used real numbers, which is exactly the carve-out working as designed), every opening turn stayed at or under 2 sentences, and the one turn that stated a clear recommendation used the S33-approved confidence pattern almost verbatim ("Clean Fruit is where I'd land" vs. the prompt's own pinned example "Crosshatch. That's where I'd land."). **One soft, debatable case flagged, not fixed**: a turn 4 reply — "floral because it actually appeals to you, or because it seemed like a safe bet?" — probes the customer's own motivation in a way that rhymes with S32's banned pattern ("What's drawing you toward earthy now — did something click?") without using its literal banned phrasing. Judged genuinely ambiguous (the customer had just hedged with "I guess," and EXPLORATION's own conversationGoal is "follow their lead," which arguably licenses checking in on a hedge) rather than editing the prompt over a single soft instance — the S76 lesson about not chasing an unbounded prompt-tuning loop against a probabilistic target on thin evidence. Flagged here for whoever next does a monthly transcript read (S33's own cadence) to weigh against more examples.

**Metrics wiring (§7) — five metrics, all now real, runnable queries for the first time.** New `backend/src/services/engagementMetrics.ts` — before this task, none of the five existed as a query anywhere; admin stats had nothing to read from ("a metric that isn't a query yet isn't a metric," the task's own words). Every event source the task asked to confirm is queryable, checked directly: `qr_scan_event` (rows written and read back throughout the journeys above), `beat_event.responded_at` (written by `respondToDialInBeat()`, S81), a brew card viewed (see below — this one didn't exist and was built), a chat turn (existing, `sommelier_sessions.turn_count`), a topic label (`context_data.topicLog`, Task 2), brew-profile write counters (`admin_stats/brew_profile`, Task 4, already had a dashboard row), guard-layer dashboard numbers (`GET /api/admin/sommelier/stats`, Task 3, unchanged). **New**: `brew_card_view_event` (SQL table) + a fire-and-forget insert in `GET /api/users/flavor-memory` — Task 6 never built a view log, and §7's "a brew card viewed" engagement leg had no data source until now; verified live (a real `GET /flavor-memory` call produced a real row, read back). The five queries and today's values (test data only — see the Shopify finding below for why there's no real customer data yet to measure):

| Metric | Query | Today's value |
|---|---|---|
| Per-bag engagement rate | `engagementMetrics.getPerBagEngagementRate()` | 1/1 bags engaged (100%) |
| Engaged vs. un-engaged reorder rate | `engagementMetrics.getEngagedVsUnengagedReorderRate()` | 1/1 engaged bags reordered (100%); 0 un-engaged bags to compare against |
| Repeat-question rate (falling is the goal) | `engagementMetrics.getRepeatQuestionRate()` | 6/14 topic-turns were repeats within their session (42.9%) |
| Brew-profile fill rate | `engagementMetrics.getBrewProfileFillRate()` | 2/7 session-starting users had a filled brew profile (28.6%) |
| Topic distribution | `engagementMetrics.getTopicDistribution()` | brewing: 7, origins_process: 4, matching: 2, my_coffee: 1, (no topic): 7 |

Sample sizes are honest, not a verdict — every row above is this pass's own test traffic (see the Shopify finding: there is currently no real customer traffic to measure). These are dials to watch once real bags exist, exactly per §7's own caution.

**Write-path audit** (the S49 rule, applied at scale — path → verified how → verifier):

| Write path | Verified | Verifier |
|---|---|---|
| `users/{uid}/metadata/brew_profile` (Firestore) | Real conversation → marker → read back via Admin SDK, correct `value`/`source` | This pass, Journey 1 |
| `user_brew_card` (SQL) | Created via `dispatchDelayedBeats()`, adjusted via a real conversation, `revision`/`params`/`last_adjustment_reason` read back | This pass, Journeys 1–2 |
| `beat_event` (SQL) | All three beat types inserted correctly, `skip_reason` correct for the repeat-bag case, `UNIQUE(user_id, order_id, beat_type)` idempotency relied upon | This pass, Journeys 1–2 |
| `qr_scan_event` (SQL) | Correct `auth_state`/`destination`/`token_type`/`source` for every journey/edge-case path | This pass, Journeys 1, 4–6 |
| `brew_card_view_event` (SQL, new this task) | Real `GET /flavor-memory` call → row read back | This pass |
| `config/sommelier` + `config/sommelier/audit/{id}` (Firestore) | Daily-cap forced-then-restored via the dot-path update + audit-doc write; both audit docs read back | This pass |
| `quiz_session` (SQL) + `users/{uid}` archetype + `users/{uid}/metadata/taste_journey` (Firestore) | Real `POST /api/quiz/results` call, profile/session rows read back | This pass |
| `users/{uid}/feedback_events/{id}` (Firestore) | Written directly for the regression test, read back, correctly drove `RECOMMENDATION_MISS` after the index fix | This pass |
| `"order"` / `order_line_item` (SQL) | Direct insert (Shopify bypassed — see below), read back, correctly fed `dispatchOrderPlacedBeat()`/`dispatchDelayedBeats()` | This pass |
| `token_events` / `user_tokens` (SQL) | Signup bonus + `usage_log` rows read back; daily-cap count/day-boundary exclusion re-verified | This pass |

**A critical, launch-blocking finding, outside this task's own fix authority: real checkout does not work at all, for anyone, right now.** `POST /api/orders` calls `createOrder()` (`shopify.ts`), which builds a Shopify draft order from each line item's `variantId` — and **zero of the 52 active `roaster_blend` rows in production have a `shopify_variant_id` set** (confirmed by direct query). This isn't a code defect — `createOrder()`'s GraphQL call is real and correctly implemented (OT-6's own description of it as "stubbed" is stale; it was implemented since, per S82/S86/S87's own successful real draft-order creations during their verification passes) — it's a missing data-sync step: the roastery Shopify product catalog has never been mapped to `roaster_blend` rows. **Confirmed via a direct count: zero rows exist in the `"order"` table in production, at all** — no real customer has ever completed a checkout. Every order used in this pass's journeys was inserted directly into `"order"`/`order_line_item`, bypassing the broken Shopify call, matching the exact precedent S82/S86/S87 already established for B2B/sponsorship test orders. This is squarely **OT-6** territory (roastery Shopify account/product-variant sync — a human/business setup dependency), not a home_v3 defect, but it means the founding-member journey's very first real step — placing an order — cannot happen for a real customer today. Flagged here with the same severity S79/S81 gave their own "still needs manual setup" items, because without it, none of Task 6/7/8's machinery ever fires for anyone.

**OT-15/OT-16/OT-17 — checked against live infrastructure, not assumed from the doc:**

- **OT-15 (Cloud Scheduler job for the arrival-note cron)**: **not done.** `gcloud scheduler jobs list` shows exactly one job (`purge-stale-anonymous-guests`) — neither `liam-sms-send` (OT-2, also still open) nor `brew-card-arrival-send` (OT-15) exist. Verified by **direct cron-endpoint invocation instead**, per the task's own instruction: `processArrivalNotes()` called directly against a real, backdated test card.
- **OT-16 (real Resend delivery)**: **the code path works and a real error is now caught correctly — but real delivery itself does not work yet, for a reason beyond what OT-16 anticipated.** Using the real production `RESEND_API_KEY` (fetched from Secret Manager, not the local `.env` placeholder S79 was stuck with), the send correctly reached Resend's real API and returned a real, structured failure: **`403 — the axisandbloomcoffee.com domain is not verified`**. This is a new, more fundamental finding than the placeholder-key limitation OT-16 was written to close — even with a real key, no transactional email from this domain can send until the domain is verified with Resend (DNS records, a Resend-side setup step, not a code fix). **Also fixed in this pass, per OT-16's own explicit invitation** ("fold into Task 9"): none of the four `resend.emails.send()` call sites in `cron.ts` (arrival note, dial-in beat, sponsored-lapsed, sponsored-trial-ending) checked the SDK's `{ data, error }` response before marking a row sent — Resend resolves rather than throws on an API-level failure, so every one of these silently marked delivery "successful" on a real failure. Fixed at all four sites: `arrival_email_sent_at`/`beat_event.sent_at` now only get set when `error` is null; a real failure (proven twice — an `example.com` domain rejection, then the real domain-verification 403) now correctly leaves the row unmarked and retryable, logged with a greppable tag. `tsc --noEmit` clean.
- **OT-17 (SMS off)**: **confirmed true.** Live `config/sommelier.beats.smsEnabled` read directly: `false`. Every beat dispatched in this pass's journeys used `channel: 'email'` (dial-in) or `'inline'` (order-placed) — never `'sms'`. No SMS send was attempted anywhere in this pass.

**Restore (before finishing, per the task's own environment note)**: `guards.dailyTurnCap` forced to `1` for the edge-case test, confirmed restored to `60` immediately after and re-read live to confirm. `tokenEconomy.gatingEnabled` and `beats.smsEnabled` were never touched during this pass (both read `false` before and after, confirmed at the start and the end). All eleven test Firebase Auth users, their Firestore trees, and every SQL row they touched (`user_profile`, `user_email`, `"order"`/`order_line_item`, `user_brew_card`, `beat_event`, `brew_card_view_event`, `quiz_session`, `sommelier_sessions`, `token_events`/`user_tokens`) deleted, confirmed zero remaining via direct re-query. Every `qr_scan_event` row this pass generated (9 rows) deleted — the tokens themselves (universal + the pre-existing per-coffee ones used for edge cases) are real production artifacts and were left untouched, same precedent as every prior QR-touching task.

**Docs**: `REGRESSION.md` created (new file — none existed before this task) with the home_v3 regression checklist. `GAPS.md` created (new file) with every consciously-deferred finding from this pass. `WHAT_WE_BUILT_DB.md` updated with the Firestore-index incident and the new `brew_card_view_event` table.

**Exit criteria, evaluated against the task file's own bar:**
- All six journeys pass. ✓
- Regression clean. ✓ (after the index fix — RECOMMENDATION_MISS now fires; the prompt diff traces cleanly to documented additions only)
- Voice pass clean. ✓ (zero clear violations; one soft case flagged, not a launch blocker)
- Every §7 metric returns a number. ✓ (test data only — see caveat above)
- Write-path audit table pasted above. ✓

## LAUNCH-READY / CONDITIONAL verdict

**CONDITIONAL.** The home_v3 machinery itself — beats, brew cards, memory, story layer, topic routing, QR resolution, the six-intent evaluator — is verified working end-to-end, including two real defects (the coffee-32-class content leak, the RECOMMENDATION_MISS Firestore-index bug) found and fixed *by* this required verification pass, not before it. Launch is blocked on three items outside this task's own authority to close, none of them a home_v3 code defect:

1. **OT-6 (Shopify product-variant sync)** — real checkout is completely non-functional (zero `roaster_blend` rows have a `shopify_variant_id`, zero real orders exist in production). Nothing in Tasks 6/7/8 can fire for a real customer until this is done. The most severe of the three.
2. **Resend domain verification for `axisandbloomcoffee.com`** — a new finding, more fundamental than OT-16's original scope; no transactional email (arrival notes, dial-in beats, or the two pre-existing sponsored-lifecycle emails) can send until this domain is verified with Resend, regardless of the API key in use. The code-side fix (checking the send result) is done; this is a Resend/DNS setup step.
3. **OT-15 (Cloud Scheduler job for `brew-card-arrival-send`)** — not created; arrival notes only go out today if invoked directly. A five-minute fix once someone has console/CLI access, same as the still-open OT-2.

None of these are things a Claude Code session can close from inside the repo. Once they are — in particular OT-6, the one with no home_v3 workaround at all — this pass's own verification of the launch machinery itself should still hold; nothing here found a reason to re-run the whole pass, only to re-run the "founding member" journey once a real order can actually complete, to confirm the same chain fires from a real Shopify order instead of a directly-inserted test row.

---

### HOME Task 9b — Post-Audit Fixes (from Task 9 / S88's flagged list) (2026-08-04)

#### S89. The archetype-adjacency migration, indexes declared as code, and a fourth live instance of S88's own bug class — found by the audit S88's own flagged item asked for

**Context**: `HOME_TASK_9B_POSTAUDIT_FIXES.md`. Dana's decisions on S88's four flagged items: two are code fixes (this task), one (the voice soft case) stays with the monthly transcript read, one (E5 wording) rides the email workstream. Also folds in Dana's confirmation that `archetype_relationship` is a legacy table, superseded by the Bloom Dial framework — `axis.ts`'s own comment already said so.

**Fix 1 — migrated `getAdjacentArchetypes()` off the dead `archetype_relationship` table onto `v_archetype_adjacency`.** The old query joined `archetype`/`archetype_relationship` directly (0 rows in prod, confirmed dead by S88) and only fell back to a hardcoded adjacency map on a *thrown* error — S88's own finding was that an *empty* result set doesn't throw, so `archetype_range`/`alternatives` silently degraded to single-archetype RAG this whole time. New version queries `v_archetype_adjacency` (the same real, hop-derived, admin-curated view `GET /api/axis/adjacency` and the Bloom Dial admin page already read — `archetype_a`/`archetype_b`/`hop_count`, symmetric via `LEAST`/`GREATEST`, ordered `hop_count DESC` so "nearest" stays a meaningful signal, not an arbitrary row order), and now treats an empty result exactly like a thrown error — both fall back to the same hardcoded map, both logged with the unmissable-log-tag pattern (`[sommelierRag:ADJACENCY_EMPTY_FALLBACK]` / `[sommelierRag:ADJACENCY_QUERY_FAILED]`, 7d/S85's own convention) instead of one path being silent and the other not. `v_archetype_adjacency` is `archetype_enum`-keyed (`chocolate_nutty`), not display-name-keyed (`Chocolate & Nutty`) — resolved by running the input through the existing `toEnum()` once before querying; `toEnum()` is idempotent on an already-enum string (falls through its own lowercase/no-spaces else-branch unchanged), so every caller downstream (which already calls `toEnum()` on whatever `getAdjacentArchetypes()` returns) needed no change.

**Table deprecated in place, not dropped** — `schema.sql`'s `archetype_relationship` definition now carries a `DEPRECATED, superseded by v_archetype_adjacency / Bloom Dial (2026-08-04)` comment naming this entry as the migration point, same dormant-data discipline as the per-coffee QR tokens after HOME_TASK_7E. Repo-wide grep for `archetype_relationship` post-fix: exactly `schema.sql` (the deprecated table + comment) and `sommelierRag.ts` (this fix's own explanatory comments, no live query) remain as code; `axis.ts`'s pre-existing comment is untouched; the two mentions in `SOMMELIER_TASK_2_BACKEND.md` are the original historical task spec, not runtime code, left alone per the S80 precedent.

**Verified — the before/after RAG counts Dana asked about most directly**, both against real production with identical inputs to S88's own smoke test (`userArchetype: 'Floral'`, `excludeCoffeeIds: [2]` for `alternatives`):

| RAG focus | S88 (degraded) | S89 (fixed) | Selected archetypes (post-fix) |
|---|---|---|---|
| `archetype_range` | 2 | **6** | floral, balanced_sweet, fruity |
| `alternatives` | 4 | **6** | floral, balanced_sweet |

Both rose, exactly as expected. `v_archetype_adjacency`'s raw Floral row confirmed the real data behind it: Floral↔Balanced&Sweet and Floral↔Fruity both at `hop_count: 4` (a tie — `alternatives`' own code only takes `adjacent[0]`, so which of the two wins on a tie depends on the query's own row order; not a bug, `alternatives` was never spec'd to use more than the nearest one).

**Fix 2 — Firestore indexes declared as code, and a fourth live bug found by the audit itself.** `firestore.indexes.json` created at repo root, generated directly from `firebase firestore:indexes --project axis-and-bloom-prod --database axis-bloom-fs` against live prod — not hand-typed, so it's guaranteed to match production exactly by construction rather than by careful transcription. `firebase.json` **does exist at repo root** (already carrying real Hosting/Cloud-Run-rewrite config) — S88's own audit had missed it (a real gap in that pass's own thoroughness, corrected here); extended with a `firestore` array entry targeting the named `axis-bloom-fs` database (this project has no `(default)` Firestore database in use at all). The deploy command (`firebase deploy --only firestore:indexes --project axis-and-bloom-prod`) is documented in `OPEN_TASKS.md`, next to OT-5 — the closest existing home for Firestore-ops steps, since `README.md` is a one-line stub. **Not wired into CI this pass**, per the task's own explicit scope — declared-and-documented was the goal, automation is future work.

**The silent-catch audit — every `.where()`/`.orderBy()` combination in `services/`/`routes/`, verdicted:**

| Site | Query shape | Verdict |
|---|---|---|
| `userSignals.ts` (negative-feedback lookup) | `createdAt` range + `sentiment` EQ | Index existed (S88); catch was still bare — **upgraded to `[userSignals:INDEX_QUERY_FAILED]`** |
| `outcomeTracker.ts`'s `updateOrderOutcomes()` | `sessionStarted` EQ + `startedAt` range | Index existed (S88); catch already logged the real error, not silent — **upgraded to the distinct `[outcomeTracker:INDEX_QUERY_FAILED]` tag** for convention consistency |
| `outcomeTracker.ts`'s `checkReturnedToSommelier()` | `sessionStarted` EQ + `startedAt` orderBy DESC | Same as above — **upgraded to the same tag** |
| `sommelier.ts`'s `RECOMMENDATION_MISS` handler (`excludeCoffeeIds`) | `sentiment` EQ + `createdAt` orderBy **DESC** | **A real, previously-undiscovered live bug** — a *different* composite index than `userSignals.ts`'s ASC-ordered version of the same shape (Firestore composite indexes are direction-specific); confirmed throwing `FAILED_PRECONDITION` on every call via a direct query before touching anything. Bare `catch { /* no feedback events */ }` — meant every `RECOMMENDATION_MISS` session's "never re-recommend a coffee they rated negatively" promise (S50's own feature) has silently never worked. **Fourth composite index created; catch upgraded to `[sommelier:INDEX_QUERY_FAILED]`.** |
| `orders.ts` (feedback revision lookup) | `orderId` EQ only | Single-field — structurally cannot need a composite index. Already commented as such. No change. |
| `users.ts` (`dial_events`, flavor-memory) | `trigger` EQ only | Single-field, safe. Catch already logs via `console.error` with context. No change. |
| `behavioralConfidence.ts` (feedback in last 180 days) | `createdAt` range only | Single-field range, safe today. Bare catch, but cannot hide an index failure as written — left as-is per the task's own scope ("any that *could* hide an index failure"); would need revisiting only if a second filter is ever added here. |
| `sommelier.ts`'s `getRecentDialActivitySummary()` | `orderBy('createdAt', 'desc')` only, no `where` | Single-field orderBy, safe — Firestore auto-indexes this. No change. |
| `sommelier.ts`'s message-history reads (×2) | `orderBy('seq')` only, no `where` | Same as above — safe, no change. |
| `admin.ts`'s stats/centroid-recompute (`collectionGroup('sommelier_evaluations').get()`, ×2) | Unfiltered scan, filtered in JS | Already deliberately engineered around the risk — one site's own comment says so explicitly ("collectionGroup date index not guaranteed"). No change. |

**Fourth index created and verified**: `feedback_events` (`sentiment` ASC + `createdAt` DESC), confirmed `READY`, `firestore.indexes.json` regenerated from the live CLI output afterward to include it (4 indexes total, matching `gcloud firestore indexes composite list` exactly — pasted both in this pass's own verification, not just claimed). Re-ran `sommelier.ts`'s exact `RECOMMENDATION_MISS` query directly: succeeds. **Full end-to-end proof, not just the direct query**: a real test account with a real negative `feedback_events` doc naming coffee 2 (alias "Jammy & Aromatic"), run through the actual `POST /api/sommelier/start` with `intent: RECOMMENDATION_MISS` — the returned `coffeeNames` correctly excluded coffee 2's alias, proving the exclusion works through the real route handler, not only in isolation.

**Verified** (`axis-and-bloom-prod` only; Cloud SQL Auth Proxy + a local backend pointed at prod, marked test data, full cleanup):
- `tsc --noEmit` clean throughout.
- Fix 1's before/after RAG counts and archetype lists: above.
- `firestore.indexes.json` generated directly from `firebase firestore:indexes` against live prod, not hand-authored — matches `gcloud firestore indexes composite list` by construction.
- Silent-catch verdict table: above.
- Real negative-feedback exclusion proven end-to-end through the live `/start` route, test account cleaned up after (Firestore tree, `user_profile`/`user_tokens`/`sommelier_sessions`/`quiz_session` rows, Firebase Auth user).

**Docs**: `GAPS.md`'s two closed flagged items moved to a new "Closed since S88" section with this entry's own reference, rather than deleted — a future reader following S88's own flagged-item list shouldn't have to guess whether item 1/2 were fixed, dropped, or just forgotten. `OPEN_TASKS.md` gained the indexes-deploy documentation next to OT-5. `WHAT_WE_BUILT_DB.md` gained the table-deprecation note and the indexes-as-code entry.

**Out of scope, per the task's own explicit list, untouched**: the voice-pass soft case (stays with the monthly transcript read); E5 wording (email workstream); OT-6/Resend-domain-verification/OT-15 (human setup, tracked in `GAPS.md`, unchanged by this pass). No prompt changes. No new features.

### Quiz Scoring Fix — the frontend finally sends what `userSignals.ts` has been waiting to read (2026-08-11)

#### S90. Removed the per-quiz Claude call; fixed the frontend dropping 5 of the fields the evaluator's feature vector depends on

**Context**: `backend/src/features/quizes/CLAUDE_CODE_PROMPT_QUIZ_REMOVE_AI_CALL.md`. Primarily a cost/latency fix (`WHAT_WE_BUILT.md` #159 has the full detail) — `POST /api/quiz/results`'s per-completion `getRecommendation()` Claude call is gone, `getRecommendation()` itself left intact and unreferenced per the spec. The half that belongs in this doc: `saveQuizResult()` had only ever sent `{ archetype, scores, answers, decaf }` to the backend, even though `POST /api/quiz/score` computes and returns `secondaryArchetype`, `foodSignal`, `foodSignalAlignment`, `recommendationMode`, and `experimental` too. The backend route and `userSignals.ts` were already written to read all of them out of `quiz_session.context_data` — they just never received anything but the `??` fallback.

**Direct Liam impact — three previously-inert pieces of the evaluator came alive**:
- **`DISCOVERY_SEEKER` fires for the first time.** It's the *first* rule in `evaluatorRulePriority`, gated on `experimental === true` — every user who picked Q3-C ("Interesting… what flavors am I getting here?") should have routed here since this evaluator shipped. None ever did, because `experimental` was always `false` on read.
- **`PROFILE_AMBIGUOUS` gains its other two legs.** Its condition is `flags.quizTie || recommendationMode === 'ai_agent' || foodSignalAlignment === 'low'` — only `quizTie` was ever reachable; `recommendationMode` was always the `'primary_only'` fallback and `foodSignalAlignment` was always `'high'`.
- **3 of the evaluator's 13 feature-vector dimensions un-zero.** `experimental ? 1 : 0`, `foodSignal === archetype`, and `foodSignal === secondaryArchetype` had been evaluating against `null`/`false` on every single call — real signal now flows into whatever downstream scoring/logging consumes that vector, including the `userStateSnapshot` written to the evaluator audit log, which had been recording five fabricated values per session.

No prompt, routing rule, or evaluator logic changed — this is purely the frontend finally supplying the inputs those already-written rules were designed around.

**Also fixed in the same pass**: `answerIds` (the raw `quiz_answer` UUIDs `/score` was called with) is now persisted on `quiz_session.context_data` and the Firestore mirror — previously only the positional `answers` (question-index → answer-index) map was saved, which is only interpretable against the exact answer ordering (`ORDER BY a.id`) active at completion time and breaks silently across a re-seed. Makes a session replayable for any future re-scoring/backfill work.

**Verified**: `tsc --noEmit` clean (backend); frontend has no committed `tsconfig.json` (documented gap, see #118/#152) — standalone `tsc --noEmit` on the two changed files clean, `vite build` clean. `npx vitest run` — same 17 pre-existing failures with and without this diff applied (`git stash` A/B comparison), none in a file this change touched; `quizScoring.test.ts`'s 6 are the spec's own documented pre-existing tie-break drift, unrelated to this fix. Full grep/import verification in `WHAT_WE_BUILT.md` #159.

**Not verified live this pass** (needs a deployed environment, listed back to Dana in #159): an actual Q3-C completion routing to `DISCOVERY_SEEKER` in a real Liam session, and a branch-quiz completion's `context_data` showing the reclassified archetype alongside the *original* secondary/foodSignal/recommendationMode (not defaults, not re-derived from the branch answer).

**Files**: `backend/src/routes/quiz.ts`, `frontend/src/app/lib/api.ts`, `frontend/src/app/components/FlavorQuiz.tsx`. No prompt files, no Firestore index, no schema change.

### Quiz Branched From — the branch parent becomes the secondary archetype on a real reclassification (2026-08-11)

#### S91. `branchedFrom` given to the evaluator — "Floral, refined out of Fruity" replaces an unexplained Floral with an unrelated runner-up

**Context**: `backend/src/features/quizes/CLAUDE_CODE_PROMPT_QUIZ_BRANCHED_FROM.md` (v2 — supersedes a same-day v1; the v2 change, decided by Dana, is that a real branch switch now overwrites `secondaryArchetype` with the branch parent rather than parking it in a side field only). Sequenced after S90 — depends on `buildQuizResultPayload()`. Full mechanism detail in `WHAT_WE_BUILT.md` #160; this entry is the evaluator-facing half.

**The gap this closes**: the quiz only scores three archetypes (Chocolate & Nutty, Balanced & Sweet, Fruity); Floral and Earthy exist only as branch outcomes. `secondaryArchetype` was always computed pre-branch, so a Floral user's recorded runner-up was Balanced & Sweet or Chocolate & Nutty — the two profiles *furthest* from them — while Fruity (their actual highest score, and the direct parent archetype) was thrown away. `userStateSnapshot` and `getUserSignals()` inherited this same blind spot.

**Fix, evaluator side**: `branchedFrom: string | null` added to `UserSignals` (`userSignals.ts`) and `UserStateSnapshot` (`sommelierEvaluator.ts`), read off `latestCtx.branchedFrom` the same way as its neighbours, populated into the `userStateSnapshot` object written to every evaluation's Firestore audit log. On a real switch, `secondaryArchetype` in that same snapshot is now the branch parent (set by the frontend at save time, per #160) — so a future evaluation log entry reads as "Floral, secondary Fruity, branchedFrom Fruity" instead of "Floral, secondary Balanced & Sweet" with no explanation of where that number came from.

**`featureVector` deliberately untouched** — still exactly 13 dimensions, same order, verified by direct read. A comment now sits above the `foodSignal === secondaryArchetype` dimension noting that on a branch-switched session `secondaryArchetype` means "branch parent" as of this change — but the dimension is structurally 0 either way for those sessions, since Q6's food signal can only ever be Chocolate & Nutty, Balanced & Sweet, or Fruity, never Floral or Earthy. Whether `branchedFrom` deserves its own vector dimension is left as an explicit future/versioned decision for Dana, per the spec's own constraint — not decided here.

**`computeConfidenceAndMode()`/`findSecondary()` confirmed untouched** — the promotion lives entirely in the frontend payload at save time (#160), so `/api/quiz/score`'s response (which `computeConfidenceAndMode` still runs against, pre-branch, with the scored secondary) is unaffected. Recomputing either post-branch was considered and explicitly rejected in the spec: `foodSignal` can never equal a Floral/Earthy winner, so doing so would collapse every branched user to `ai_agent`/low confidence.

**Verified**: `tsc --noEmit` clean (backend); frontend standalone `tsc --noEmit` on the two changed files clean (same no-`tsconfig.json` gap as S90); `featureVector` length/order re-read directly post-edit (13, unchanged); `computeConfidenceAndMode` grepped to confirm its only call site is still `POST /score`; `quizScoring.ts` confirmed untouched by this diff. `npx vitest run` — identical 17 pre-existing failures to S90's baseline, nothing new. Full detail: `WHAT_WE_BUILT.md` #160.

**Not verified live this pass** (needs a deployed environment, listed back to Dana in #160): a real Fruity→Floral branch completion's evaluator log actually showing `branchedFrom: 'Fruity'` / `secondaryArchetype: 'Fruity'` together in a live `sommelier_evaluations` doc.

**Out of scope, per the spec's own explicit constraints**: no historical backfill of `branchedFrom` on existing sessions; no `scoredRunnerUp`/`tertiaryArchetype` field added anywhere.

### Cron Secret Incident (2026-08-15)

#### S92. CRON_SECRET rotated after a UTF-8 BOM made it unmatchable — every cron job that shares it affected, including this feature's own S17/S19

Full diagnosis, evidence, and verification in `WHAT_WE_BUILT.md` #166; the S17 decision entry above now carries the same pointer. No Sommelier logic, prompt, evaluator, or schema changed — this is a continuity note only, recorded here because `liam-sms-send` (S17-S20) is one of the cron jobs that shares `CRON_SECRET`, and because `[cron/secret-config]`, the new boot-time hygiene check added to `backend/src/index.ts`, now covers every consumer of this decision's shared secret, not just the two jobs the incident happened to surface on. No `sommelier_sms_feedback`/`feedback_events` behavior changed; `processPendingMessages()` itself was never observed failing from this, but only because `liam-sms-send` has no Cloud Scheduler job configured in prod yet at all — same "still needs manual setup" gap S79/S80/S81 each flagged for their own cron routes (`gcloud scheduler jobs list` confirms only `purge-stale-anonymous-guests`/`purge-api-events` exist as jobs today) — it shares the identical `requireCronSecret` comparison and would have hit the exact same wall the moment a job for it was ever created with the old, BOM-carrying secret.

**Files**: `backend/src/services/userSignals.ts`, `backend/src/services/sommelierEvaluator.ts` (plus `backend/src/routes/quiz.ts`, `frontend/src/app/lib/api.ts`, `frontend/src/app/components/FlavorQuiz.tsx` — shared with #160). No new Firestore index, no schema change.
