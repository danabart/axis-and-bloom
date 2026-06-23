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

Stored in Firestore `users/{uid}/confidence_profile`. Recomputed after quiz, orders, and feedback. Weights and thresholds admin-configurable in `config/sommelier`.

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
| `users/{uid}/confidence_profile` | Behavioral confidence score, components, raw inputs. Also stores `hasPendingNegativeFeedback` flag (set by SMS feedback parser, read by evaluator for RECOMMENDATION_MISS) |
| `users/{uid}/sommelier_evaluations/{id}` | One document per evaluation — intent label (ML label), feature vector (13-dim), user state snapshot, triggers fired, outcome (written back when known) |
| `users/{uid}/taste_journey` | Archetype history over time — evolution count, current streak, history array |
| `users/{uid}/feedback_events/{id}` | One document per feedback signal from Liam (SMS replies, future in-app ratings). Fields: `signalType`, `rating`, `sValue`, `confidence`, `source`, `sentiment`, `rawText`, `descriptors`, `orderId`, `blendId`, `liamSmsFeedbackId`, `createdAt`. Read by `behavioralConfidence.ts` for `feedbackAlignment` component. |

---

## SQL Tables (new)

| Table | Purpose |
|---|---|
| `sommelier_sessions` | One row per sommelier session — intent, turn count, close reason, context_data JSONB |
| `sommelier_messages` | One row per turn — role, content, model_used, session FK |
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
| `Sommelier.tsx` | `/sommelier` | Liam chat UI — intent label, coffee strip, turn counter, token balance, all states |

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
**Decision**: SQL queries use the proper `"order"` table (quoted, reserved word). Firestore feedback_events subcollection may not exist yet — query wrapped in try/catch, treats zero docs as zero events (→ feedbackAlignment 0.50 neutral). Writes to `users/{uid}/confidence_profile` with `set(..., { merge: true })` and `hasPendingNegativeFeedback` flag. Called as fire-and-forget from quiz results route after quiz session is saved (so the new quiz counts in the computation).

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
