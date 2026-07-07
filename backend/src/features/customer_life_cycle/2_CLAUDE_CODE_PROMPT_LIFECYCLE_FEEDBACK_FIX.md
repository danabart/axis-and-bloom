# Fix: `FIRST_ORDER_FEEDBACK_PENDING` is silently overriding every other lifecycle stage

## What testing found

Your own test run (5 order-bearing scenarios: subscriber, reorder-due, lapsed-single, active-repeat, and a genuine feedback-pending case) showed all 5 landing on `FIRST_ORDER_FEEDBACK_PENDING` — because none had a Firestore feedback doc for their first two orders. Correctly diagnosed: `classifyStage()` in `backend/src/services/userLifecycle.ts` checks feedback-pending *before* the subscriber/reorder/repeat checks, and that check has no upper time bound — so a real subscriber who simply never answered the feedback ask on order #1 gets stuck seeing "How was your coffee?" forever instead of their subscription status.

## Root cause, precisely

```ts
// current classifyStage(), lines ~31-40
const earlyOrders = signals.orders.slice(0, 2);
const pendingEarlyOrder = earlyOrders.find(
  o => !o.hasFeedback && daysSince(o.createdAt) >= FEEDBACK_WINDOW_START_DAYS
);
if (pendingEarlyOrder) return 'FIRST_ORDER_FEEDBACK_PENDING';
```

Two problems in one: (1) this is a mutually-exclusive early return, so it structurally can't coexist with `SUBSCRIBER`/`REORDER_DUE`/etc. — whichever the user's *actual* standing relationship is gets shadowed for as long as the early order lacks feedback; (2) there's a lower bound (`FEEDBACK_WINDOW_START_DAYS`) but no upper bound, so "as long as" can mean indefinitely.

This is a design gap from the original spec (`1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md`), not a coding mistake — feedback-pending and standing relationship status were described as separate concerns there, but ended up implemented as one mutually-exclusive enum. Fixing the spec gap:

## The fix — pending feedback becomes an independent flag, not a stage

A user's *standing* lifecycle stage (subscriber, overdue to reorder, active repeat, lapsed, etc.) and "is there an unanswered feedback ask sitting out there" are two different, simultaneously-true-able facts. Don't make one shadow the other.

**1. `backend/src/services/userLifecycle.ts`** — remove the early-return block from `classifyStage()` entirely:

```ts
export function classifyStage(signals: UserSignals): string {
  if (signals.quizCount === 0) return 'NEW_NO_QUIZ';

  if (signals.totalOrders === 0) {
    const days = signals.daysSinceLastQuiz ?? 0;
    if (days < QUIZ_FRESH_DAYS) return 'QUIZ_TAKEN_FRESH_NO_ORDER';
    if (days <= QUIZ_DRIFTED_DAYS) return 'QUIZ_TAKEN_SETTLED_NO_ORDER';
    return 'QUIZ_STALE_NO_ORDER';
  }

  // (feedback-pending check removed — no longer a stage, see getPendingFeedbackOrder())

  if (signals.hasActiveSubscription) return 'SUBSCRIBER';
  // ...rest unchanged (totalOrders === 1 branch, 2+ orders branch)
}
```

Add a new standalone export, replacing the deleted block's logic but with an upper bound added:

```ts
export const FEEDBACK_ASK_EXPIRES_DAYS = 60; // stop asking on-site after this — SMS already tried at day 10 for orders 1-2; past this, further nudging just feels naggy

export function getPendingFeedbackOrder(signals: UserSignals): { orderId: string; blendId: string | null } | null {
  const earlyOrders = signals.orders.slice(0, 2);
  const pending = earlyOrders.find(o => {
    if (o.hasFeedback) return false;
    const age = daysSince(o.createdAt);
    return age >= FEEDBACK_WINDOW_START_DAYS && age <= FEEDBACK_ASK_EXPIRES_DAYS;
  });
  return pending ? { orderId: pending.id, blendId: pending.blendId ?? null } : null;
}
```

(Adjust field names to match whatever `UserSignals['orders']` actually looks like in the current implementation — check the type before wiring this up.)

**2. `backend/src/db/schema.sql` / a migration** — `FIRST_ORDER_FEEDBACK_PENDING` is no longer a valid stage. Don't hard-delete the row (it may already be referenced by `user_lifecycle_event.to_stage_id`/`from_stage_id` rows from testing — deleting it would break those FKs). Instead:

```sql
UPDATE user_lifecycle_stage SET is_active = false, homepage_enabled = false
WHERE code = 'FIRST_ORDER_FEEDBACK_PENDING';
```

Any `user_lifecycle_state` rows currently pointing at it will self-correct the next time `refreshLifecycleState()` runs for that user (which happens on the next quiz/order/feedback event, or immediately on their next homepage visit per the existing fallback-compute path) — no backfill needed, the whole point of this design is that state is always re-derivable from current facts.

**3. `backend/src/routes/users.ts` (`GET /api/users/homepage-state`)** — call `getPendingFeedbackOrder(signals)` unconditionally, not gated on `stageCode`:

```ts
const pendingFeedbackOrder = getPendingFeedbackOrder(signals);
let pendingFeedback: { orderId: string; blendName: string | null } | null = null;
if (pendingFeedbackOrder) {
  const blendResult = await db.query(
    `SELECT rb.blend_name FROM order_line_item oli
     JOIN roaster_blend rb ON rb.id = oli.blend_id
     WHERE oli.order_id = $1 LIMIT 1`,
    [pendingFeedbackOrder.orderId]
  );
  pendingFeedback = { orderId: pendingFeedbackOrder.orderId, blendName: blendResult.rows[0]?.blend_name ?? null };
}
```

Remove the `if (stageCode === 'FIRST_ORDER_FEEDBACK_PENDING')` gate around this block — the blend lookup should run whenever a pending order exists, regardless of what the real `stageCode` turned out to be. The response shape (`stageCode`, `archetype`, `daysSinceQuiz`, `pendingFeedback`, `usualBlend`, `nextDeliveryDate`) doesn't need to change — `pendingFeedback` just gets populated more often now, alongside a real `stageCode` instead of instead of one.

**4. `frontend/src/app/components/Home.tsx` (`renderSignedInCTA()`)** — this is currently one if/else chain returning a single block per `stageCode`. Restructure so the feedback nudge is layered independently:

```tsx
function renderSignedInCTA() {
  if (homepageStateLoading || !homepageState) return null;
  const { stageCode, archetype, pendingFeedback, usualBlend, nextDeliveryDate } = homepageState;

  const feedbackNudge = pendingFeedback && !feedbackDismissed ? (
    <div style={{ marginBottom: 32 }}>
      <p style={ctaHeadlineStyle}>How was<br />{pendingFeedback.blendName ?? 'your coffee'}?</p>
      <div style={{ marginTop: 24, width: '100%', maxWidth: 400 }}>
        <OrderFeedbackForm orderId={pendingFeedback.orderId} blendName={pendingFeedback.blendName} onSubmitted={() => setFeedbackDismissed(true)} />
      </div>
      <button type="button" onClick={() => { localStorage.setItem(`axisBloomFeedbackDismiss_${pendingFeedback.orderId}`, String(Date.now())); setFeedbackDismissed(true); }} style={{ ...ctaSecondaryLinkStyle, background: 'none', border: 'none', cursor: 'pointer' }}>
        Not now
      </button>
    </div>
  ) : null;

  // remove the old `if (stageCode === 'FIRST_ORDER_FEEDBACK_PENDING' ...)` branch entirely —
  // that stage code no longer exists. Every other branch (NEW_NO_QUIZ, QUIZ_TAKEN_*, SUBSCRIBER,
  // REORDER_DUE, LAPSED_SINGLE_ORDER, ACTIVE_REPEAT_USER fallback) stays exactly as it is —
  // just wrap the whole thing so feedbackNudge renders above it when present:

  return (
    <>
      {feedbackNudge}
      {/* ...existing if/else chain on stageCode, unchanged... */}
    </>
  );
}
```

The dismissal-suppression `useEffect` (currently gated on `stageCode === 'FIRST_ORDER_FEEDBACK_PENDING'`) should instead key off `pendingFeedback?.orderId` directly, since that field now exists independently of `stageCode`.

## Re-test

Re-run the same 5 scenarios from your test report and confirm:
- Subscriber with an unanswered feedback ask on order #1 → `stageCode: 'SUBSCRIBER'`, `pendingFeedback` populated → homepage shows the subscription-status CTA *plus* the feedback nudge above it, not instead of it.
- Same for reorder-due, lapsed-single, and active-repeat — each shows its correct standing CTA with the feedback nudge layered on top when applicable.
- The genuine feedback-pending scenario (single recent order, no subscription, within `FEEDBACK_WINDOW_START_DAYS`–`FEEDBACK_ASK_EXPIRES_DAYS`) still surfaces the nudge correctly, now alongside whatever its real stage is (likely `ACTIVE_REPEAT_USER` for a fresh single order).
- A new case worth adding: an order older than `FEEDBACK_ASK_EXPIRES_DAYS` (60 days) with no feedback should **not** trigger the nudge at all anymore — confirms the new upper bound works.
