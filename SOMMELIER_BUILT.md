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
