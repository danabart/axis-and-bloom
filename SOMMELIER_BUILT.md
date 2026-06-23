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
| `discovery` | DISCOVERY_SEEKER | Experimental coffees + graph traversal via `coffee_relationships` |
| `exact_match` | CONVERSION | User's primary archetype, best editorial content |
| `curated_mix` | EXPLORATION | 1 best-content coffee per archetype |

The formatted `catalogText` is stored in `sommelier_sessions.context_data.catalogText` at session start — not re-queried on every turn.

**Coffee relationship graph (`coffee_relationships` table):**
Used by `discovery` and `alternatives` RAG focus types for dimensional hop traversal. See Bloom Dial section below.

---

## Bloom Dial and Coffee Relationships

### `coffee_relationships` table

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

### `archetype_dial_positions` table

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

1. User lands on their archetype's default coffee (`is_default = true` in `archetype_dial_positions`)
2. User clicks "More Intense" → query `coffee_relationships WHERE from_coffee_id = X AND hop_label = 'More Intense' AND hop_type = 'within_archetype'`
3. Returns the next coffee in that direction
4. Can chain multiple hops (Classic → Intense → Very Intense)

### How it improves Liam

- `DISCOVERY_SEEKER` RAG traverses the `coffee_relationships` graph outward from the user's current coffee, not just pulling by archetype label
- `RECOMMENDATION_MISS` uses the graph directionally: if feedback suggests "too strong," traverse `direction = 'less'` on bitterness/body

---

## Firestore Collections (new)

| Path | Content |
|---|---|
| `config/sommelier` | All admin-configurable values: weights, thresholds, intents, token economy, model routing, RAG limits, time windows, rule priority |
| `config/sommelierCentroids` | Intent centroid vectors (13-dim average of feature vectors per intent). Recomputed on demand via admin button. |
| `users/{uid}/confidence_profile` | Current behavioral confidence score, components, raw inputs |
| `users/{uid}/sommelier_evaluations/{id}` | One document per evaluation — intent label (ML label), feature vector (13-dim), user state snapshot, triggers fired, outcome (written back when known) |
| `users/{uid}/taste_journey` | Archetype history over time — evolution count, current streak, history array |

---

## SQL Tables (new)

| Table | Purpose |
|---|---|
| `sommelier_sessions` | One row per sommelier session — intent, turn count, close reason, context_data JSONB |
| `sommelier_messages` | One row per turn — role, content, model_used, session FK |
| `user_tokens` | Token balance per user — balance, lifetime earned/spent |
| `token_events` | Audit trail — every earn and spend with reason and reference ID |
| `archetype_config` | Dominant dimension and Bloom Dial flag per archetype (seeded, 5 rows) |
| `dial_position_vocabulary` | Archetype+dimension-specific label vocabulary for the Bloom Dial (seeded, 20 rows) |
| `coffee_relationships` | Navigation graph — directional hops between coffees along dimensions |
| `archetype_dial_positions` | Bloom Dial positions — maps coffees to a vocabulary position per archetype |

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

---

## Admin Portal (new pages)

| Route | Page | Purpose |
|---|---|---|
| `/admin/sommelier/config` | AdminSommelierConfig | Edit weights, thresholds, token economy, model routing, session limits, rule priority |
| `/admin/sommelier/intents` | AdminIntentEditor | Edit per-intent: addendum, label, RAG focus, max turns, active toggle |
| `/admin/sommelier/flow` | AdminSommelierFlow | Visual flow diagram with live stats and config overlay |

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

---

## Issues and Decisions

*(Append here after each task is completed — follow the same format as WHAT_WE_BUILT.md)*
