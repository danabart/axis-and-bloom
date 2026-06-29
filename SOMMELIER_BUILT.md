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

---

## Firestore Collections (new)

| Path | Content |
|---|---|
| `config/sommelier` | All admin-configurable values: weights, thresholds, intents, token economy, model routing, RAG limits, time windows, rule priority |
| `config/sommelierCentroids` | Intent centroid vectors (13-dim average of feature vectors per intent). Recomputed on demand via admin button. |
| `users/{uid}/metadata/confidence_profile` | Behavioral confidence score, components, raw inputs. Also stores `hasPendingNegativeFeedback` flag (set by SMS feedback parser, read by evaluator for RECOMMENDATION_MISS). **Path note**: 4 segments required — `metadata` is a subcollection, `confidence_profile` is the document. |
| `users/{uid}/sommelier_evaluations/{id}` | One document per evaluation — intent label (ML label), feature vector (13-dim), user state snapshot, triggers fired, outcome (written back when known) |
| `users/{uid}/sommelier_sessions/{sessionId}/messages/{auto-id}` | Conversation messages — `role` (`user`\|`assistant`), `content`, `modelUsed`, `seq` (0-based integer for ordering), `createdAt` (server timestamp). `sessionId` matches the `sommelier_sessions.id` integer from PostgreSQL. Written here instead of the `sommelier_messages` SQL table as of 2026-06-27. `seq` formula: 0 = opening, `turn_count * 2 - 1` = user messages, `turn_count * 2` = assistant replies. |
| `users/{uid}/taste_journey` | Archetype history over time — evolution count, current streak, history array |
| `users/{uid}/feedback_events/{id}` | One document per feedback signal from Liam (SMS replies, future in-app ratings). Fields: `signalType`, `rating`, `sValue`, `confidence`, `source`, `sentiment`, `rawText`, `descriptors`, `orderId`, `blendId`, `liamSmsFeedbackId`, `createdAt`. Read by `behavioralConfidence.ts` for `feedbackAlignment` component. |

---

## SQL Tables (new)

| Table | Purpose |
|---|---|
| `sommelier_sessions` | One row per sommelier session — intent, turn count, close reason, context_data JSONB |
| `sommelier_messages` | **Legacy** — one row per turn (role, content, model_used, session FK). Messages now written to Firestore `users/{uid}/sommelier_sessions/{sessionId}/messages` as of 2026-06-27. Table kept for backwards compatibility; `GET /:sessionId/messages` falls back to it for sessions created before the migration. |
| `user_tokens` | Token balance per user — balance, lifetime earned/spent |
| `token_events` | Audit trail — every earn and spend with reason and reference ID |
| `dial_archetype_config` | Dominant dimension and Bloom Dial flag per archetype (seeded, 5 rows) |
| `dial_position_vocabulary` | Archetype+dimension-specific label vocabulary for the Bloom Dial (seeded, 20 rows) |
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

#### S14. `schedulePostDeliveryMessage` takes firebase UID, not user_profile UUID
**Decision**: The spec signature was `schedulePostDeliveryMessage(userId, orderId, blendId)` where `userId` = `user_profile.id`. But `orders.ts` only has `req.uid` (firebase UID). The function was changed to accept `(firebaseUid: string, blendId: string | null)` and does the `user_profile` lookup internally. Idempotency is keyed on `(user_id, blend_id)` — one outbound message per blend per user.

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

#### S33. Liam — demographic tone calibration, brand values, register mirroring (2026-06-28)

**`sommelierEvaluator.ts`** — Stage 1 demographic query:
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
