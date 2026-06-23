# Coffee Sommelier — Claude Code Task Index

Five tasks. Run Task 1 first. Tasks 2 and 3 can run in parallel after Task 1. Task 4 goes after Task 2. Task 5 is independent once Task 2 is done.

**Task files are in:** `backend/src/AI Agent - Liam/`

```
Task 1 — Foundation (no dependencies)
    ↓
Task 2 — Backend          Task 3 — Admin Portal
(depends on Task 1)       (depends on Task 1, parallel with Task 2)
    ↓                           
Task 4 — Frontend         Task 5 — SMS Feedback Loop
(depends on Task 2)       (depends on Task 2, can run in parallel with Task 4)
```

---

## Task files

| File | What it builds |
|---|---|
| `SOMMELIER_TASK_1_FOUNDATION.md` | SQL schema (sommelier + token tables), Firestore config document, `sommelierConfig.ts` live listener, `behavioralConfidence.ts`, token initialization on signup, token earning on orders, feature vectors (13-dim), intent centroid storage, `taste_journey` writes, rename `foodSignalAlignment`, tie detection |
| `SOMMELIER_TASK_2_BACKEND.md` | Evaluator (rule-based + Haiku + Firestore write), RAG service (including Bloom Dial graph), token service (transactional), outcome tracker, `chatWithSommelier()` with Liam persona, all `/api/sommelier/*` routes, `/api/tokens/*` routes (balance + Stripe placeholder), remove old agent |
| `SOMMELIER_TASK_3_ADMIN.md` | Config editor, intent editor, flow diagram with live stats, Bloom Dial admin page (`dial_archetype_positions` + `dial_coffee_relationships`) |
| `SOMMELIER_TASK_4_FRONTEND.md` | Liam chat UI with token balance display, quiz tie interstitial ("Talk to Liam"), profile and coffees entry points with token state, routing |
| `SOMMELIER_TASK_5_FEEDBACK.md` | Post-delivery SMS feedback loop — `liam_sms_feedback` table, `smsProvider.ts` (placeholder), `liamSmsFeedback.ts`, cron endpoint, inbound webhook, Haiku reply parsing, negative signal → Firestore flag → RECOMMENDATION_MISS |

---

## Key decisions baked in

**The AI persona is Liam.** All system prompts, UI labels, and user-facing copy use "Liam" as the sommelier's name.

**Token model, not subscription-gating.**
- New users: 20 tokens on signup (enough for ~2–3 conversations)
- Orders: +10 tokens per order placed
- Each sommelier turn: -1 token (atomic SQL transaction)
- Token purchases: Stripe placeholder — endpoint exists, returns 503 until wired
- All token economy values are admin-configurable in Firestore (no deploy needed to change)

**Two confidence variables (distinct concepts):**
- `foodSignalAlignment` — renamed from the existing `confidence` field. Derived from the food instinct quiz question. Drives `recommendationMode`. Logic unchanged.
- `behavioralConfidence` — new composite score (0.0–1.0) from quiz stability, order behavior, data depth, feedback alignment. Stored in Firestore. Powers the evaluator.

**Sonnet trigger — content-based only, no turn-count trigger:**
- Message contains a complexity keyword (configurable list in admin)
- Message is over N words (configurable in admin, default 100)
- Default model is always Haiku

**ML-ready data layer:**
- Every evaluation stores a 13-dimensional `featureVector` and `featureSchema` (so the schema is self-describing)
- Intent string is the ML label
- Full `userStateSnapshot` captured at decision time — never updated after creation
- `outcome` fields written back when behavior is observed (order, return visit, feedback)
- Intent centroid vectors stored in `config/sommelierCentroids`, recomputed on demand via admin button

**Six intents — one sommelier, different behavior per session:**
`PROFILE_AMBIGUOUS` · `RECOMMENDATION_MISS` · `TASTE_EVOLUTION` · `DISCOVERY_SEEKER` · `CONVERSION` · `EXPLORATION`

All intent configuration (addenda, labels, RAG focus, active toggle) is editable from the admin portal without a code deploy.

**SMS feedback loop — provider is a placeholder:**
- SMS provider not yet chosen — `smsProvider.ts` defines the interface but returns `SMS_PROVIDER_NOT_CONFIGURED` (same pattern as Stripe)
- Wire a real provider (Twilio recommended) by replacing the body of `sendSms()` — nothing else needs to change
- Feedback replies parsed by Haiku → written to `user_feedback_event` → feeds `behavioralConfidence` and `RECOMMENDATION_MISS` trigger
- Only sent to users with `sms_opt_in = true` on their `user_phone` row
- Scheduled 10 days after order, for orders 1 and 2 only
