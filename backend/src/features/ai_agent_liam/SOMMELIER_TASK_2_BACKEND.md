# Sommelier Task 2 — Backend
## Evaluator, RAG, Liam, Token Gate, and API Routes

**Depends on Task 1 being complete.** Before starting, verify:
- `getSommelierConfig()` importable from `sommelierConfig.ts`
- `computeBehavioralConfidence()` importable from `behavioralConfidence.ts`
- `sommelier_sessions`, `sommelier_messages`, `user_tokens`, `token_events` tables exist
- `config/sommelier` document exists in Firestore

---

## Read these files first

1. `WHAT_WE_BUILT.md` — API reference and infrastructure
2. `WHAT_WE_BUILT_DB.md` — full database schema reference (all tables, enums, views — read this before writing any SQL queries)
2. `backend/src/services/claude.ts` — existing AI functions
3. `backend/src/routes/agent.ts` — placeholder to remove
4. `backend/src/services/sommelierConfig.ts` — from Task 1
5. `backend/src/services/behavioralConfidence.ts` — from Task 1

---

## 1. Remove the existing placeholder

Delete `backend/src/routes/agent.ts`. In `backend/src/services/claude.ts`, remove `chatWithAgent()` and the `SYSTEM_PROMPT` constant. Keep `getRecommendation()`, `getCoffeeSummary()`, `getCoffeeSurpriseNote()`, `getCoffeeThreeVoiceStory()`. Remove the `/api/agent` route registration from `backend/src/index.ts`.

---

## 2. `sommelierEvaluator.ts`

Create `backend/src/services/sommelierEvaluator.ts`.

```typescript
type EvaluatorFlags = {
  quizTie?: boolean
  tiedArchetypes?: string[]
  userInitiated?: boolean
  browsingSignal?: boolean
}

type EvaluatorResult = {
  needsSommelier: boolean
  intent: string | null
  triggersFired: string[]
  openingContext: string | null
  evaluationId: string | null
  featureVector: number[]
  featureSchema: string[]
  userStateSnapshot: UserStateSnapshot
}
```

### Stage 1 — Rule-based classification

Collect from Cloud SQL and Firestore:
- Latest and second-latest `quiz_session` rows
- `behavioralConfidence` from `users/{uid}/confidence_profile`
- Negative feedback on AI-recommended coffees in last `config.timeWindows.negativeFeedbackLookback` days
- Order count for this user

Compute the feature vector (13 dimensions in the order defined in Task 1 section 9).

Apply rules in `config.evaluatorRulePriority` order. Record ALL matching rules in `triggersFired`. First matching active intent wins:

- **DISCOVERY_SEEKER**: `experimental === true` in latest quiz `context_data`
- **PROFILE_AMBIGUOUS**: `flags.quizTie === true` OR `recommendationMode === 'ai_agent'` OR `foodSignalAlignment === 'low'`
- **TASTE_EVOLUTION**: latest archetype differs from second-latest archetype (requires ≥ 2 quiz sessions)
- **RECOMMENDATION_MISS**: negative feedback found on AI-recommended coffee in lookback window
- **CONVERSION**: `behavioralConfidence.level !== 'low'` AND order count === 0
- **EXPLORATION**: `flags.userInitiated === true` OR `flags.browsingSignal === true`

If no rule matches: `needsSommelier: false`, return early (skip Stages 2 and 3).

### Stage 2 — Haiku enrichment

Single Haiku call to generate `openingContext` — a 1–2 sentence briefing for Liam about this specific user. Used on turn 1 only.

System: `"You generate concise briefings. Respond with only the briefing text, no preamble."`

User:
```
Initialize a coffee sommelier session. Write 1-2 sentences briefing Liam (the sommelier) about this specific user before their first exchange. Be factual and specific.

Intent: {intent}
Goal: {config.intents[intent].conversationGoal}
Archetype: {archetype}, Secondary: {secondaryArchetype or 'none'}
Behavioral confidence: {level} (score: {score:.2f})
Experimental: {experimental}
Quiz count: {quizCount}, Archetype changes: {archetypeChangeCount}
Order count: {totalOrders}
Recent negative feedback: {yes/no}
Days since last quiz: {N or 'first quiz'}

Write only the briefing.
```

Max tokens: 100.

### Stage 3 — Write evaluation to Firestore

Write to `users/{uid}/sommelier_evaluations` using `firestoreDb.collection(...).add(...)`. Include `featureVector`, `featureSchema`, full `userStateSnapshot`, `intent`, `triggersFired`, `needsSommelier: true`, `sessionStarted: false`, all `outcome` fields null. Return the Firestore document ID as `evaluationId`.

---

## 3. `sommelierRag.ts`

Create `backend/src/services/sommelierRag.ts`.

```typescript
type RagParams = {
  ragFocus: string
  userArchetype: string | null
  previousArchetype?: string | null
  excludeCoffeeIds?: number[]
}

type RagResult = {
  catalogText: string    // formatted string for injection into system prompt
  coffeeIds: number[]    // for storage in session context_data
}
```

Max coffees from `getSommelierConfig().ragLimits.maxCoffees`.

**By RAG focus:**

- **`archetype_range`**: 2 coffees from each of the 3 nearest archetypes (via `archetype_relationship`). If no archetype: 2 from the 3 most populated archetypes.
- **`alternatives`**: Exclude `excludeCoffeeIds`. 3 from user archetype + 3 from one adjacent archetype.
- **`evolution_bridge`**: 3 from `previousArchetype` + 3 from `userArchetype`.
- **`discovery`**: All Experimental archetype coffees first, then fill with lowest-affinity archetypes from `archetype_relationship`.
- **`exact_match`**: User's primary archetype only. Order: `ai_summary IS NOT NULL DESC`, then `surprise_note IS NOT NULL DESC`. Max 5.
- **`curated_mix`**: 1 per archetype — the one with most complete editorial data (has `ai_summary`, `surprise_note`, ≥ 2 descriptors).

**Per coffee, fetch:** `coffees.id`, `coffees.name`, `roaster.name`, current archetype assignment, `ai_summary`, `surprise_note`, top 4 descriptors from `v_collaborative_flavor_wheel`.

**Formatted output:**
```
YOUR CURRENT CATALOG — Liam may only recommend coffees from this list:
---
[Coffee Name] — [Roaster] — [Archetype]
Tasting note: [ai_summary or 'Not yet available']
What's unexpected: [surprise_note or 'Not yet available']
Key flavors: [descriptor1, descriptor2, descriptor3, descriptor4]
---
```

---

## 4. `tokenService.ts`

Create `backend/src/services/tokenService.ts`.

### `getTokenBalance(uid: string): Promise<number>`
`SELECT balance FROM user_tokens WHERE uid = $1`. Returns 0 if no row.

### `spendToken(uid: string, reason: string, referenceId: string): Promise<{ success: boolean, newBalance: number }>`

Uses a SQL transaction with `SELECT FOR UPDATE` to prevent race conditions:

```sql
BEGIN;
SELECT balance FROM user_tokens WHERE uid = $1 FOR UPDATE;
-- If balance < costPerTurn: ROLLBACK, return { success: false, newBalance: balance }
UPDATE user_tokens
SET balance = balance - $2,
    lifetime_spent = lifetime_spent + $2,
    updated_at = NOW()
WHERE uid = $1;
INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
SELECT $1, -$2, $3, $4, balance FROM user_tokens WHERE uid = $1;
COMMIT;
```

After success: fire-and-forget sync of new balance to Firestore `users/{uid}` field `tokenBalance`.

### `grantTokens(uid: string, amount: number, reason: string, referenceId?: string): Promise<number>`

Same transactional pattern but adds tokens (no balance check needed).

---

## 5. `outcomeTracker.ts`

Create `backend/src/services/outcomeTracker.ts`.

Export: `writeOutcome(uid: string, evaluationId: string, fields: Partial<OutcomeFields>): Promise<void>`

Merges fields into `users/{uid}/sommelier_evaluations/{evaluationId}.outcome`. Sets `outcomeUpdatedAt`. Fire-and-forget — try/catch internally, log errors without throwing.

Wire into:
- `POST /api/orders` — write `orderedWithin7Days` / `orderedWithin30Days` to evaluations from last 30 days where outcome is still null
- Any feedback event write — write `feedbackAfterSession`
- New session start — check prior evaluations for `returnedToSommelier`

Also add `tokensSpent` to the outcome fields. Written when a session closes, summing all `token_events` rows for this session (query by `reference_id = sessionId`).

---

## 6. `chatWithSommelier()` in `claude.ts`

Add to `backend/src/services/claude.ts`. Entirely separate from existing functions. The AI persona is **Liam**.

```typescript
export async function chatWithSommelier(params: {
  message: string | null     // null on turn 0 (opening message)
  session: {
    intent: string
    turnCount: number
    openingContext: string
  }
  catalogContext: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<{ reply: string; modelUsed: string }>
```

### System prompt construction

```
[BASE LIAM PROMPT]
[CATALOG BLOCK — catalogContext]
[INTENT ADDENDUM — config.intents[intent].systemPromptAddendum]
[CONVERSATION GOAL — "Your goal: {config.intents[intent].conversationGoal}"]
[OPENING CONTEXT — turn 0 only: "Context for this user: {openingContext}"]
[CLOSING SIGNAL — when turnCount === config.sessionLimits.maxTurns - 1:
  "This is one of the final turns. Work toward a concrete recommendation or clear next step."]
```

### Base Liam prompt (hardcoded string)

```
You are Liam, the Axis & Bloom Coffee Sommelier. You are warm, precise, and genuinely curious. Your job is not to sell coffee — it is to understand the person in front of you and guide them toward something they will love.

Rules:
- Your name is Liam. Use it naturally if asked.
- Only recommend coffees from the catalog provided. Never invent a coffee or make up a tasting note.
- Ask at most one follow-up question per turn.
- Keep responses under 180 words.
- Be specific. Name actual flavors and sensations. Avoid vague terms like "smooth" or "rich" without qualification.
```

### Model routing (from config — no hardcoded values)

Check in this order:
1. Count words in the user's message. If `wordCount >= config.modelRouting.sonnetMinMessageWords` → use Sonnet
2. If message contains any keyword from `config.modelRouting.sonnetKeywords` (case-insensitive) → use Sonnet
3. Default → Haiku

Models: Haiku = `claude-haiku-4-5-20251001`, Sonnet = `claude-sonnet-4-6`

Return `{ reply, modelUsed }`. `modelUsed` is saved to `sommelier_messages`.

### Turn 0 (opening message)

When `message === null`, do not include a user message in the messages array. Claude generates the opening greeting from the system prompt alone.

---

## 7. Stripe token purchase placeholder

Add `POST /api/tokens/purchase` to a new route file `backend/src/routes/tokens.ts`. Register at `/api/tokens`.

Auth required. Body: `{ tokenPackId: string, paymentMethodId: string }` (accepted but ignored).

Response: `503 { error: 'payments_not_yet_configured', message: 'Token purchases will be available soon.' }`

This stub exists so the frontend can wire to a real endpoint without any code change when Stripe is added.

Also add `GET /api/tokens/balance` (auth required): returns `{ balance, lifetimeEarned, lifetimeSpent }` from `user_tokens`. Used by the frontend to display current balance.

---

## 8. Backend routes

Create `backend/src/routes/sommelier.ts`. Register at `/api/sommelier` in `backend/src/index.ts`.

All routes require `requireAuth`.

---

### `POST /api/sommelier/evaluate`

No token check. Free to call.

Body: `{ quizTie?: boolean, tiedArchetypes?: string[], userInitiated?: boolean }`

1. `await computeBehavioralConfidence(uid)` — refresh first
2. `await evaluateSommelier(uid, flags)` — runs all three stages
3. Return `{ needsSommelier, intent, openingContext, evaluationId }`

---

### `POST /api/sommelier/start`

Token check here (not subscription check).

Body: `{ intent, openingContext, evaluationId, tiedArchetypes? }`

1. Check token balance: `await tokenService.getTokenBalance(uid)`. If balance < `config.tokenEconomy.costPerTurn`: return `402 { error: 'insufficient_tokens', balance, message: 'You need at least 1 token to start a conversation with Liam.' }`
2. Check for resumable session: query `sommelier_sessions` where `uid = $1 AND is_closed = false AND last_active_at > NOW() - INTERVAL '{resumeWindowHours} hours'`. If found: return `{ resumableSession: { sessionId, intent, turnCount, turnsRemaining } }`.
3. Determine `ragFocus` from `config.intents[intent].ragFocus`
4. Determine `excludeCoffeeIds` if RECOMMENDATION_MISS
5. Determine `previousArchetype` if TASTE_EVOLUTION
6. `ragResult = await fetchSommelierCoffees({ ragFocus, userArchetype, previousArchetype, excludeCoffeeIds })`
7. Insert `sommelier_sessions` row — `context_data`: `{ intent, archetype, tiedArchetypes, openingContext, ragFocus, coffeeIds: ragResult.coffeeIds, catalogText: ragResult.catalogText, evaluationId }`
8. Update Firestore evaluation: `{ sessionStarted: true, sessionId: newSessionId }`
9. Spend 1 token for the opening turn: `await tokenService.spendToken(uid, 'sommelier_turn', String(newSessionId))`
10. Call `chatWithSommelier({ message: null, session: { intent, turnCount: 0, openingContext }, catalogContext: ragResult.catalogText, history: [] })`
11. Insert opening message to `sommelier_messages` (role: `assistant`, model_used)
12. Update session: `turn_count = 1`, `last_active_at = NOW()`
13. Return `{ sessionId, openingMessage, coffeeNames: [...], tokenBalance: newBalance, turnsRemaining: maxTurns - 1 }`

---

### `POST /api/sommelier/:sessionId/message`

Body: `{ message }`

1. Fetch session — verify ownership + not closed + `turn_count < maxTurns`
2. Check token balance ≥ `costPerTurn`. If not: `402 { error: 'insufficient_tokens', balance }`
3. Save user message to `sommelier_messages`
4. Fetch all messages for this session ordered `created_at ASC`
5. Spend 1 token: `await tokenService.spendToken(uid, 'sommelier_turn', String(sessionId))`
6. Call `chatWithSommelier({ message, session: { intent, turnCount: session.turn_count }, catalogContext: context_data.catalogText, history })`
7. New `turn_count` = `session.turn_count + 1`
8. If `turn_count >= maxTurns`: set `is_closed = true`, `close_reason = 'turn_limit'`; call `writeOutcome(uid, evaluationId, { sessionCompleted: true, turnsUsed: turn_count, tokensSpent: N })`
9. Update session: `turn_count`, `last_active_at`, `is_closed`, `close_reason`
10. Save assistant message to `sommelier_messages`
11. Return `{ reply, turnCount: newTurnCount, sessionClosed: is_closed, turnsRemaining: maxTurns - newTurnCount, tokenBalance: newBalance, modelUsed }`

---

### `GET /api/sommelier/sessions`

Returns last 5 sessions: `id`, `intent`, `started_at`, `turn_count`, `is_closed`, `close_reason`.

---

### `POST /api/sommelier/:sessionId/close`

1. Fetch session, verify ownership. If already closed: return 200 (idempotent).
2. Set `is_closed = true`, `close_reason = 'user_closed'`
3. Call `writeOutcome(uid, evaluationId, { sessionCompleted: false, turnsUsed: session.turn_count })`
4. Return `{ closed: true }`

---

## Coffee relationship graph in RAG

The Bloom Dial tables were created in June 2026 and are present in the database. Use them directly — no existence check needed.

**Table reference:**
- `dial_coffee_relationships` — directional hop graph. Key columns: `from_coffee_id`, `to_coffee_id`, `dimension_id` (FK → `coffee_dimensions`), `direction` (`hop_direction_enum`: `more` | `less`), `delta`, `hop_label`, `hop_type` (`hop_type_enum`: `within_archetype` | `bridge_archetype`), `is_recommended`, `confidence`
- `dial_archetype_positions` — coffee positions on the dial per archetype. Key columns: `archetype` (`archetype_enum`), `coffee_id`, `position_label`, `dial_description`, `sort_order`, `is_default`
- `dial_archetype_config` — dominant dimension + `has_bloom_dial` flag per archetype (5 seeded rows)
- `dial_position_vocabulary` — archetype+dimension-specific label set (20 seeded rows)
- `v_dial_navigation` — view: hop graph with coffee names and dimension names resolved. Use this for RAG queries instead of joining raw tables.
- `v_dial_positions` — view: dial positions with coffee names, labels, and default flag resolved.

**`discovery` (DISCOVERY_SEEKER):** After fetching Experimental archetype coffees, supplement with coffees reachable via `v_dial_navigation` from the user's current coffee — specifically `hop_type = 'bridge_archetype'` AND `is_recommended = true`. This gives Liam real dimensional hops to reference, not just archetype labels.

**`alternatives` (RECOMMENDATION_MISS):** When excluding negatively-rated coffees, also query `v_dial_navigation` to find "lighter" or "less intense" alternatives — hops with `direction = 'less'` on the dimension most associated with the negative feedback. Include up to 2 of these alongside the adjacent archetype coffees.

If either view query fails unexpectedly, fall back to archetype-only RAG and log: `[sommelierRag] Bloom Dial query failed — using archetype-only RAG`.

---

## Before you finish: update documentation

When all checklist items are done, append a summary to `SOMMELIER_BUILT.md` under "Issues and Decisions". Include: evaluator rule logic decisions, Haiku prompt iterations, any token transaction edge cases found, RAG focus query performance, model routing behavior observed during testing, and anything unexpected.

---

## What NOT to change

- `getRecommendation()`, `getCoffeeSummary()`, `getCoffeeSurpriseNote()`, `getCoffeeThreeVoiceStory()`
- Quiz scoring logic in `quizScoring.ts`
- All admin routes, cupping tool, orders, users, auth routes
- CI/CD, Dockerfile

---

## Definition of done

- [ ] `agent.ts` deleted, `chatWithAgent()` removed, route deregistered
- [ ] `sommelierEvaluator.ts` — Stage 1 rules (config-driven priority), Stage 2 Haiku, Stage 3 Firestore write with featureVector
- [ ] `sommelierRag.ts` — all 6 RAG focus types, `catalogText` and `coffeeIds` returned
- [ ] `tokenService.ts` — `getTokenBalance`, `spendToken` (transactional), `grantTokens`
- [ ] `outcomeTracker.ts` — wired to orders, feedback, session close; includes `tokensSpent`
- [ ] `chatWithSommelier()` — Liam persona, config-driven model routing (keywords + word count only, no turn-count trigger), turn 0 support
- [ ] `/api/tokens/balance` and `/api/tokens/purchase` (placeholder) registered
- [ ] `/api/sommelier/evaluate` — confidence refresh + full evaluation
- [ ] `/api/sommelier/start` — token check, resumable check, RAG, opening message, token spend
- [ ] `/api/sommelier/:sessionId/message` — token check per turn, model routing, turn limit, outcome on close
- [ ] `/api/sommelier/sessions` and `/api/sommelier/:sessionId/close`
