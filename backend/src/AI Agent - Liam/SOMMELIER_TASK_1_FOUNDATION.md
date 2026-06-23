# Sommelier Task 1 — Foundation
## Infrastructure, Config, Token Economy, and Data Layer

**Run this task first. Tasks 2, 3, and 4 all depend on it.**

---

## Read these files first

1. `WHAT_WE_BUILT.md` — full infrastructure reference
2. `WHAT_WE_BUILT_DB.md` — full database schema reference (all tables, enums, views, indexes — read this for anything DB-related)
3. `backend/src/db/schema.sql` — the actual schema file you will edit
3. `backend/src/services/firebase-admin.ts` — Firestore client setup
4. `backend/src/services/quizScoring.ts` — existing confidence/mode logic
5. `backend/src/routes/auth.ts` — user signup flow, to wire token initialization

---

## 1. Rename `confidence` → `foodSignalAlignment`

In `backend/src/routes/quiz.ts`, rename the `confidence` field to `foodSignalAlignment` in responses from `POST /api/quiz/score` and `POST /api/quiz/results`. The values (`high`, `medium`, `low`) and the logic in `quizScoring.ts` do not change — only the field name in the JSON response.

Search the frontend for any component reading `.confidence` from quiz endpoints and update those references to `.foodSignalAlignment`.

---

## 2. Tie detection in quiz scoring

In `backend/src/routes/quiz.ts`, update `POST /api/quiz/score`:

When the veto cascade exhausts without resolving, add to the response:
```json
{
  "tieDetected": true,
  "tiedArchetypes": ["Archetype A", "Archetype B"]
}
```

When there is no tie: `"tieDetected": false`, `"tiedArchetypes": []`. Keep `archetype: "Balanced & Sweet"` as the technical fallback so nothing downstream breaks.

---

## 3. SQL schema additions

Add all of the following to `backend/src/db/schema.sql`. All idempotent.

### Sommelier tables (place near `chat_messages`)

```sql
CREATE TABLE IF NOT EXISTS sommelier_sessions (
  id               SERIAL PRIMARY KEY,
  uid              TEXT NOT NULL,
  intent           TEXT NOT NULL,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  last_active_at   TIMESTAMPTZ DEFAULT NOW(),
  turn_count       INT DEFAULT 0,
  is_closed        BOOLEAN DEFAULT FALSE,
  close_reason     TEXT,
  context_data     JSONB
);

CREATE TABLE IF NOT EXISTS sommelier_messages (
  id           SERIAL PRIMARY KEY,
  session_id   INT NOT NULL REFERENCES sommelier_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  model_used   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

`context_data` on `sommelier_sessions` stores:
`{ intent, archetype, tiedArchetypes, openingContext, ragFocus, coffeeIds, catalogText, evaluationId }`

Note: `catalogText` is the pre-built RAG string, stored at session start so it does not need to be rebuilt on every turn.

### Token economy tables (place near `user_profile`)

```sql
CREATE TABLE IF NOT EXISTS user_tokens (
  uid                TEXT PRIMARY KEY REFERENCES user_profile(firebase_uid) ON DELETE CASCADE,
  balance            INT NOT NULL DEFAULT 0,
  lifetime_earned    INT NOT NULL DEFAULT 0,
  lifetime_spent     INT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_events (
  id           SERIAL PRIMARY KEY,
  uid          TEXT NOT NULL,
  delta        INT NOT NULL,           -- positive = earned, negative = spent
  reason       TEXT NOT NULL,          -- 'signup_bonus' | 'order_bonus' | 'sommelier_turn' | 'purchase' | 'admin_grant'
  reference_id TEXT,                   -- order ID, session ID, etc. for audit
  balance_after INT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Token initialization on signup

In `backend/src/routes/auth.ts`, in `POST /api/auth/sync` (called after every Firebase sign-in/signup):

After the `user_profile` upsert, check if a `user_tokens` row exists for this uid. If not (new user), insert one with `balance = config.tokenEconomy.signupBonus` and insert a `token_events` row with `reason = 'signup_bonus'`, `delta = signupBonus`, `balance_after = signupBonus`.

Use the `ON CONFLICT DO NOTHING` pattern to make this idempotent — existing users with a token row are not affected.

```sql
INSERT INTO user_tokens (uid, balance, lifetime_earned)
VALUES ($1, $2, $2)
ON CONFLICT (uid) DO NOTHING;
```

Only insert the `token_events` row if the `user_tokens` insert actually created a new row (check `rowCount === 1`).

---

## 5. Token earning on order placed

In `backend/src/routes/orders.ts` (or wherever orders are created), after a successful order save:

Award `config.tokenEconomy.orderBonus` tokens to the user. Use a SQL transaction:

```sql
BEGIN;
UPDATE user_tokens
SET balance = balance + $2,
    lifetime_earned = lifetime_earned + $2,
    updated_at = NOW()
WHERE uid = $1;

INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
SELECT $1, $2, 'order_bonus', $3, balance
FROM user_tokens WHERE uid = $1;
COMMIT;
```

After the transaction, sync the new balance to Firestore `users/{uid}` (add `tokenBalance: N` to the profile snapshot) — fire-and-forget.

---

## 6. Firestore config document

Create the global sommelier config at Firestore path `config/sommelier`. Write a one-time seed script at `backend/src/db/seeds/sommelier_config_seed.ts`. Auto-seed on startup if the document does not exist.

Full config document structure:

```typescript
{
  // Behavioral confidence weights — must sum to 1.0
  confidenceWeights: {
    quizStability: 0.30,
    behavioralValidation: 0.40,
    dataDepth: 0.20,
    feedbackAlignment: 0.10
  },

  // Confidence level thresholds (inclusive lower bound)
  confidenceThresholds: {
    medium: 0.40,
    high: 0.70
  },

  // Session limits (turns per session — tokens are the access gate, not session count)
  sessionLimits: {
    maxTurns: 8
  },

  // Token economy
  tokenEconomy: {
    signupBonus: 20,
    orderBonus: 10,
    costPerTurn: 1,
    purchaseEnabled: false    // Stripe placeholder — set true when payments configured
  },

  // Model routing — Sonnet triggered by content signals only, not turn count
  modelRouting: {
    sonnetKeywords: [
      "compare", "difference", "explain", "why", "confused",
      "not sure", "don't understand", "what do you mean",
      "help me understand", "which is better", "how does"
    ],
    sonnetMinMessageWords: 100    // messages over 100 words trigger Sonnet
  },

  // RAG
  ragLimits: {
    maxCoffees: 6
  },

  // Evaluator rule priority
  evaluatorRulePriority: [
    "DISCOVERY_SEEKER",
    "PROFILE_AMBIGUOUS",
    "TASTE_EVOLUTION",
    "RECOMMENDATION_MISS",
    "CONVERSION",
    "EXPLORATION"
  ],

  // Time windows (days unless noted)
  timeWindows: {
    negativeFeedbackLookback: 60,
    orderOutcome7Day: 7,
    orderOutcome30Day: 30,
    returnVisitWindow: 30,
    sessionResumeWindowHours: 24
  },

  // Per-intent configuration
  intents: {
    PROFILE_AMBIGUOUS: {
      active: true,
      label: "Discovering your profile",
      conversationGoal: "Understand the user's taste through dialogue before recommending. Do not recommend a coffee until turn 3 or later.",
      systemPromptAddendum: "This user's quiz signals were ambiguous — their profile is not yet clear. Do not recommend a coffee in your first two turns. Ask about specific things they enjoy in food and drink, or how they usually take their coffee. Build a picture before suggesting anything.",
      ragFocus: "archetype_range",
      maxTurns: 8
    },
    RECOMMENDATION_MISS: {
      active: true,
      label: "Finding a better match",
      conversationGoal: "Understand what didn't work, then find an alternative. Exclude previously negatively-rated coffees.",
      systemPromptAddendum: "A previous recommendation did not resonate with this user. Acknowledge this gently. Ask what specifically felt off: flavor, body, intensity, context? Exclude any coffee they have already rated negatively.",
      ragFocus: "alternatives",
      maxTurns: 8
    },
    TASTE_EVOLUTION: {
      active: true,
      label: "Recalibrating your taste",
      conversationGoal: "Explore what changed since the last quiz, then recalibrate toward the updated profile.",
      systemPromptAddendum: "This user's taste profile changed since their last quiz. Explore what may have changed: a new coffee experience, travel, a different time of day they drink? Understand the evolution before making any recommendation.",
      ragFocus: "evolution_bridge",
      maxTurns: 8
    },
    DISCOVERY_SEEKER: {
      active: true,
      label: "Going somewhere unexpected",
      conversationGoal: "Push toward something genuinely unexpected. Do not default to the user's primary archetype.",
      systemPromptAddendum: "This user explicitly chose the adventurous option in their quiz — they want to be surprised. Do not play it safe. Lead with contrast, unusual processing methods, unexpected flavor combinations. Frame coffees by what makes them unusual, not how closely they match the user's archetype.",
      ragFocus: "discovery",
      maxTurns: 8
    },
    CONVERSION: {
      active: true,
      label: "Taking the first step",
      conversationGoal: "Remove hesitation and help the user place their first order. Answer questions. Do not sell.",
      systemPromptAddendum: "This user has a clear flavor profile but has not ordered yet. Be practical and reassuring. Offer to answer any questions about the coffee, process, or what to expect. Do not be pushy.",
      ragFocus: "exact_match",
      maxTurns: 8
    },
    EXPLORATION: {
      active: true,
      label: "Exploring together",
      conversationGoal: "Open-ended discovery. Let the user lead.",
      systemPromptAddendum: "This user came to explore without a specific prompt. Be curious and open. Don't assume they want a recommendation — they may just want to talk about coffee. Follow their lead.",
      ragFocus: "curated_mix",
      maxTurns: 8
    }
  },

  // Confidence component definitions
  confidenceComponents: {
    quizStability: {
      active: true,
      label: "Quiz Stability",
      description: "How consistent has the archetype been across quiz retakes?"
    },
    behavioralValidation: {
      active: true,
      label: "Behavioral Validation",
      description: "Are orders confirming the archetype?"
    },
    dataDepth: {
      active: true,
      label: "Data Depth",
      description: "Volume of total interactions (quizzes + orders + feedback)."
    },
    feedbackAlignment: {
      active: true,
      label: "Feedback Alignment",
      description: "Is feedback consistent with the archetype?"
    }
  },

  updatedAt: <server timestamp>
}
```

Firestore security rule for `config/*`: backend Admin SDK bypasses rules. Add a client-side rule allowing admin reads only:
```
match /config/{doc} {
  allow read: if request.auth != null && request.auth.token.admin == true;
  allow write: if false;
}
```

---

## 7. `sommelierConfig.ts` — live config service

Create `backend/src/services/sommelierConfig.ts`.

Loads `config/sommelier` on startup via Firestore `onSnapshot` real-time listener. Keeps an in-memory copy. All other services import from this module — no hardcoded config values anywhere.

```typescript
export function getSommelierConfig(): SommelierConfig
export async function initSommelierConfig(): Promise<void>
export type SommelierConfig
```

Call `initSommelierConfig()` in `backend/src/index.ts` before `app.listen()`. If the document does not exist, auto-run the seed script first.

Log on every config update: `[sommelierConfig] Config updated — keys changed: [...]`

---

## 8. `behavioralConfidence.ts` — confidence computation

Create `backend/src/services/behavioralConfidence.ts`.

Export: `computeBehavioralConfidence(uid: string): Promise<BehavioralConfidenceResult>`

1. Reads weights and thresholds from `getSommelierConfig()` — never hardcoded
2. Queries inputs from two sources:
   - **Cloud SQL**: all `quiz_session` rows for this user (ordered `completed_at DESC`); all `order` rows with coffee archetype (join `archetype_assignments`)
   - **Firestore**: `users/{uid}/feedback_events` — all documents from last 180 days. Do NOT read from the SQL `user_feedback_event` table — Liam feedback is written to Firestore only. The SQL table exists for the old recommendation engine and is not Liam's source of truth.
3. Computes active components only (skip inactive, redistribute weights proportionally):

   - **quizStability**: 1 quiz → 0.30; 2+ same archetype → 0.90; any change → 0.15
   - **behavioralValidation**: 0 orders → 0.40 neutral; else archetype-matched / total
   - **dataDepth**: `Math.min(Math.log10(1 + totalInteractions) / Math.log10(20), 1.0)` — `totalInteractions` = quiz count + order count + feedback event count
   - **feedbackAlignment**: 0 events → 0.50 neutral; else events where `sValue >= 0.6` / total. For `negativeFeedbackFlag` (feature vector dim 10): set to 1.0 if any event has `sentiment = 'negative'` in the last 60 days.

4. Final score = weighted sum. Level: `>= high threshold` → `high`; `>= medium threshold` → `medium`; else `low`
5. Writes to Firestore `users/{uid}/confidence_profile` with `set(..., { merge: true })`
6. Returns `BehavioralConfidenceResult`

**Firestore `feedback_events` document shape** (written by Task 5 — read here):
```typescript
{
  orderId: string,          // SQL order UUID
  blendId: string,          // SQL roaster_blend UUID
  signalType: string,       // 'liam_sms' | 'rating' | 'repurchase' | 'skip'
  rating: number,           // 1–5
  sValue: number,           // 0.0–1.0 normalized
  confidence: number,       // 0.0–1.0
  source: string,           // 'sms' | 'app'
  sentiment?: string,       // 'positive' | 'negative' | 'neutral'
  descriptors?: string[],   // flavor words (SMS replies)
  liamSmsFeedbackId?: string,
  createdAt: Timestamp
}
```

Call (non-blocking) after: quiz results save, order placed, feedback event written to Firestore.

---

## 9. Feature vectors on evaluations

Every `sommelier_evaluations` document must include two fields for ML readiness:

```typescript
featureSchema: string[]   // ordered list of feature names — defines what each index means
featureVector: number[]   // normalized numerical representation of userStateSnapshot
```

**Feature schema (13 dimensions, in this order):**
```
[
  'quizStability',           // component value 0.0-1.0
  'behavioralValidation',    // component value 0.0-1.0
  'dataDepth',               // component value 0.0-1.0
  'feedbackAlignment',       // component value 0.0-1.0
  'normalizedOrderCount',    // Math.min(log10(1 + orders) / log10(20), 1.0)
  'normalizedDaysSinceQuiz', // 1 - Math.min(daysSinceLastQuiz / 365, 1.0) — higher = more recent
  'normalizedQuizCount',     // Math.min(log10(1 + quizzes) / log10(10), 1.0)
  'archetypeChangeFraction', // changes / max(quizCount - 1, 1) — 0 if only 1 quiz
  'experimentalFlag',        // 1.0 if experimental, 0.0 otherwise
  'quizTieFlag',             // 1.0 if tie detected, 0.0 otherwise
  'negativeFeedbackFlag',    // 1.0 if recent negative feedback, 0.0 otherwise
  'foodMatchesPrimary',      // 1.0 if foodSignalAlignment === 'high', 0.0 otherwise
  'foodMatchesSecondary'     // 1.0 if foodSignalAlignment === 'medium', 0.0 otherwise
]
```

The `featureSchema` array is always included verbatim in every evaluation document so the schema is self-describing. The `featureVector` is computed at evaluation time from the `userStateSnapshot` and the `behavioralConfidence` result.

---

## 10. Intent centroid vectors

Store intent centroids in Firestore at `config/sommelierCentroids`. This is a separate document from `config/sommelier`.

Structure:
```typescript
{
  DISCOVERY_SEEKER: {
    centroid: number[],     // 13-dimensional average of all featureVectors with this intent
    sampleCount: number,
    updatedAt: Timestamp
  },
  PROFILE_AMBIGUOUS: { ... },
  TASTE_EVOLUTION: { ... },
  RECOMMENDATION_MISS: { ... },
  CONVERSION: { ... },
  EXPLORATION: { ... },
  computedAt: Timestamp
}
```

Add a backend endpoint `POST /api/admin/sommelier/recompute-centroids` (admin only) that:
1. Reads all `sommelier_evaluations` documents across all users (Admin SDK)
2. Groups by `intent`, filters to only those with a valid `featureVector`
3. For each intent: averages all feature vectors component-by-component
4. Writes the result to `config/sommelierCentroids`

This is a manual trigger for now. No scheduled job yet. Admin clicks a button in the admin portal (Task 3 will add the button).

---

## 11. Firestore: `sommelier_evaluations` structure

Path: `users/{uid}/sommelier_evaluations/{evaluationId}`

```typescript
{
  evaluationId: string,
  createdAt: Timestamp,
  intent: string,               // ML LABEL — the classification assigned
  triggersFired: string[],      // all rules that matched (for audit)
  needsSommelier: boolean,
  sessionStarted: boolean,
  sessionId: number | null,

  featureSchema: string[],      // always the 13-element array defined above
  featureVector: number[],      // 13-element array computed at evaluation time

  userStateSnapshot: {
    archetype: string | null,
    secondaryArchetype: string | null,
    foodSignalAlignment: string | null,
    recommendationMode: string | null,
    experimental: boolean,
    behavioralConfidence: { score: number, level: string, components: object },
    quizCount: number,
    archetypeChangeCount: number,
    totalOrders: number,
    daysSinceLastQuiz: number | null,
    recentNegativeFeedback: boolean,
    quizTie: boolean,
    tiedArchetypes: string[]
  },

  outcome: {
    sessionCompleted: boolean | null,
    turnsUsed: number | null,
    tokensSpent: number | null,
    orderedWithin7Days: boolean | null,
    orderedWithin30Days: boolean | null,
    feedbackAfterSession: 'positive' | 'negative' | 'none' | null,
    returnedToSommelier: boolean | null,
    outcomeUpdatedAt: Timestamp | null
  }
}
```

---

## 12. Firestore: `taste_journey` writes

After every `POST /api/quiz/results`:

Write to `users/{uid}/taste_journey` using `set(..., { merge: true })`. If archetype is same as `currentArchetype`: increment `currentStreakCount`. If different: push to `archetypeHistory`, update `currentArchetype`, increment `evolutionCount`, reset streak to 1.

```typescript
archetypeHistory entries: {
  archetype: string,
  date: Timestamp,
  quizSessionId: string,
  confidenceLevel: string,   // behavioralConfidence.level at that moment
  trigger: 'first_quiz' | 'retake'
}
```

Fire-and-forget. Always write after the behavioral confidence computation so `confidenceLevel` is fresh.

---

## Before you finish: update documentation

When all checklist items are done, append a summary of what was built to `SOMMELIER_BUILT.md` under "Issues and Decisions". Follow the same format as `WHAT_WE_BUILT.md` — one entry per meaningful decision or problem solved, with a title, cause, and fix/decision. Include: schema additions, any idempotency decisions, token initialization approach, config seed behavior, and anything unexpected encountered.

---

## What NOT to change

- Computation logic in `quizScoring.ts`
- Existing admin routes, cupping tool, quiz frontend (beyond the rename)
- CI/CD, Dockerfile, Firebase Hosting config

---

## Definition of done

- [ ] `confidence` renamed to `foodSignalAlignment` in quiz routes and frontend
- [ ] Tie detection added to `POST /api/quiz/score` response
- [ ] `sommelier_sessions`, `sommelier_messages`, `user_tokens`, `token_events` tables in schema.sql, idempotent
- [ ] Token initialization wired into `POST /api/auth/sync` (signup bonus, idempotent)
- [ ] Token earning wired into orders route (order bonus, transactional)
- [ ] `config/sommelier` Firestore document created with seed, auto-seeded on startup
- [ ] `config/sommelierCentroids` Firestore document initialized empty on startup
- [ ] Firestore security rules for `config/*`
- [ ] `sommelierConfig.ts` — live listener, `getSommelierConfig()` exported, `initSommelierConfig()` in index.ts
- [ ] `behavioralConfidence.ts` — computes from SQL, writes to Firestore, uses config weights
- [ ] Feature vector (13 dimensions) computed and stored on every evaluation
- [ ] `featureSchema` stored alongside `featureVector` in every evaluation document
- [ ] `POST /api/admin/sommelier/recompute-centroids` endpoint added to admin routes
- [ ] `taste_journey` written after every quiz completion
