# Sommelier Task 5 — Liam SMS Feedback Loop
## Post-Delivery Feedback via Text Message

**Depends on Task 2 being complete.** Does not modify the sommelier chat flow.

Before starting, verify:
- `notification_log`, `user_phone` tables exist in Cloud SQL
- `behavioralConfidence.ts` exists (`backend/src/services/`) — Task 1
- `sommelierEvaluator.ts` exists (`backend/src/services/`) — Task 2
- Firestore named instance `axis-bloom-fs` is accessible via `firestoreDb` from `backend/src/services/firebase-admin.ts`
- `users/{uid}/confidence_profile` Firestore document structure is defined (Task 1)
- Order creation route exists (check `WHAT_WE_BUILT.md` for the exact file)

---

## Read these files first

1. `WHAT_WE_BUILT.md` — project architecture, Firestore structure (`users/{uid}`, `users/{uid}/quiz_sessions`), backend patterns, order flow
2. `WHAT_WE_BUILT_DB.md` — SQL schema reference; pay attention to `notification_log`, `user_phone`, `order`, `roaster_blend`
3. `SOMMELIER_BUILT.md` — Firestore collections already planned (confidence_profile, sommelier_evaluations, taste_journey, config/sommelier), behavioralConfidence components, RECOMMENDATION_MISS trigger
4. `backend/src/db/schema.sql` — `notification_log` columns, `user_phone` columns
5. `backend/src/services/firebase-admin.ts` — `firestoreDb` export and named instance `axis-bloom-fs`
6. `backend/src/services/behavioralConfidence.ts` — `computeBehavioralConfidence(uid)` signature, how it reads from Firestore
7. `backend/src/services/sommelierEvaluator.ts` — RECOMMENDATION_MISS trigger; how it reads negative feedback flags

---

## Overview

10 days after a customer places their first or second order, Liam sends them a personal SMS. If they reply, Haiku parses the free text into a structured signal and writes it to Firestore `users/{uid}/feedback_events`. A negative signal updates `users/{uid}/confidence_profile` with a flag that the evaluator checks on their next sommelier session.

```
Order #1 or #2 placed
    ↓ (fire-and-forget)
schedulePostDeliveryMessage() → inserts liam_sms_feedback row in SQL (status='scheduled', scheduled_for=NOW()+10 days)
    ↓ (daily cron, Cloud Scheduler)
GET /api/cron/liam-sms-send → processPendingMessages()
    ↓ (SMS provider — placeholder until wired)
smsProvider.sendSms() → logs to notification_log (SQL)
liam_sms_feedback status → 'sent'
    ↓ (customer replies)
POST /api/webhooks/sms/inbound
    ↓
parseInboundReply() → Haiku extracts sentiment + rating + descriptors
    ↓
Firestore: ADD users/{uid}/feedback_events/{auto-id}   ← new subcollection, same pattern as quiz_sessions
SQL: UPDATE liam_sms_feedback (haiku_parsed=true, firestore_feedback_doc_id)
    ↓ (if negative)
Firestore: UPDATE users/{uid}/confidence_profile { hasPendingNegativeFeedback: true, ... }   ← existing doc from Task 1
    ↓
computeBehavioralConfidence(uid) — recompute immediately
```

---

## Step 1: Schema additions

Add to `backend/src/db/schema.sql` (fully idempotent — use `IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`).

### 1a. SMS opt-in on user_phone

```sql
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_opt_in     BOOLEAN DEFAULT FALSE;
ALTER TABLE user_phone ADD COLUMN IF NOT EXISTS sms_opt_in_at  TIMESTAMPTZ;
```

Only send SMS to users where `sms_opt_in = true`. Default is false — users opt in explicitly from their profile settings.

### 1b. New table: liam_sms_feedback

Add before the indexes block:

```sql
CREATE TABLE IF NOT EXISTS liam_sms_feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES user_profile(id) ON DELETE CASCADE,
  order_id             UUID REFERENCES "order"(id),
  blend_id             UUID REFERENCES roaster_blend(id),
  phone_number         TEXT NOT NULL,
  direction            TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','sent','delivered','failed','replied','opted_out')),
  scheduled_for        TIMESTAMPTZ,
  sent_at              TIMESTAMPTZ,
  provider_message_id  TEXT,
  reply_to_id          UUID REFERENCES liam_sms_feedback(id),
  haiku_parsed              BOOLEAN DEFAULT FALSE,
  parsed_signal_type        TEXT,
  parsed_rating             INTEGER,
  parsed_sentiment          TEXT CHECK (parsed_sentiment IN ('positive','negative','neutral')),
  parsed_descriptors        JSONB,
  firestore_feedback_doc_id TEXT,   -- Firestore doc ID in users/{uid}/feedback_events/{id}
  created_at                TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_liam_sms_user      ON liam_sms_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_liam_sms_order     ON liam_sms_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_liam_sms_status    ON liam_sms_feedback(status);
CREATE INDEX IF NOT EXISTS idx_liam_sms_scheduled ON liam_sms_feedback(scheduled_for)
  WHERE status = 'scheduled';
```

---

## Step 2: SMS provider service (placeholder)

Create `backend/src/services/smsProvider.ts`.

The real SMS provider (Twilio or similar) is not yet configured. Define the interface now so wiring it later is a drop-in replacement. Credentials will live in GCP Secret Manager under `SMS_PROVIDER_ACCOUNT_SID`, `SMS_PROVIDER_AUTH_TOKEN`, `SMS_FROM_NUMBER` when ready.

```typescript
export interface SmsMessage {
  to: string;       // E.164 format: +15551234567
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export async function sendSms(message: SmsMessage): Promise<SmsSendResult> {
  // TODO: replace with Twilio or chosen provider
  // import twilio from 'twilio';
  // const client = twilio(accountSid, authToken);
  // const msg = await client.messages.create({ from, to: message.to, body: message.body });
  // return { success: true, providerMessageId: msg.sid };
  console.warn('[smsProvider] SMS provider not configured — message not sent to:', message.to);
  return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
}
```

Every call to `sendSms()` — success or failure — must write a row to `notification_log`:
```sql
INSERT INTO notification_log
  (user_id, order_id, channel, message_type, recipient_contact, delivery_status, external_provider_id, metadata)
VALUES
  ($userId, $orderId, 'sms', 'liam_feedback_request', $phone, $status, $providerMessageId, $metadata)
```
`delivery_status` = `'sent'` on success, `'failed'` on error. `metadata` = `{ liamSmsFeedbackId }`.

---

## Step 3: liamSmsFeedback.ts service

Create `backend/src/services/liamSmsFeedback.ts`.

### schedulePostDeliveryMessage(userId, orderId, blendId)

Called when an order is placed (Step 4). Returns early silently on any skip condition — never throws.

1. Look up the user's phone: `SELECT phone_number, sms_opt_in FROM user_phone WHERE user_id = $userId AND sms_opt_in = true LIMIT 1`. If no row, log and return.
2. Idempotency check: `SELECT id FROM liam_sms_feedback WHERE order_id = $orderId AND direction = 'outbound'`. If found, return.
3. Look up coffee name for the blend. Check `WHAT_WE_BUILT_DB.md` for the correct join path from `roaster_blend` → `coffees`. Use the coffee name in the message body.
4. Look up user first name from `user_profile`.
5. Compose message (keep under 160 chars):

   Primary: `Hey [first_name]! It's Liam from Axis & Bloom — how are you finding the [Coffee Name]? Any thoughts welcome 🌸`

   If over 160 chars: `Hey [first_name], it's Liam from Axis & Bloom! How's the [Coffee Name] treating you? Any thoughts?`

6. Insert:
   ```sql
   INSERT INTO liam_sms_feedback
     (user_id, order_id, blend_id, phone_number, direction, body, status, scheduled_for)
   VALUES
     ($1, $2, $3, $phone, 'outbound', $body, 'scheduled', NOW() + INTERVAL '10 days')
   ```

---

### processPendingMessages()

Called by the daily cron. Fetches due outbound messages and sends them.

```sql
SELECT lsf.*, up.first_name
FROM liam_sms_feedback lsf
JOIN user_profile up ON up.id = lsf.user_id
WHERE lsf.direction = 'outbound'
  AND lsf.status = 'scheduled'
  AND lsf.scheduled_for <= NOW()
ORDER BY lsf.scheduled_for ASC
LIMIT 100
```

For each row:
1. Call `sendSms({ to: row.phone_number, body: row.body })`
2. Success: `UPDATE liam_sms_feedback SET status = 'sent', sent_at = NOW(), provider_message_id = $sid WHERE id = $id`
3. Failure: `UPDATE liam_sms_feedback SET status = 'failed' WHERE id = $id`
4. Write `notification_log` row either way

Return `{ processed: N, sent: N, failed: N }`.

---

### parseInboundReply(inboundBody, outboundRow)

Called from the inbound webhook after the inbound row is inserted. Uses Haiku to extract structured feedback from free text.

**Haiku prompt:**
```
You are parsing a coffee feedback SMS reply for Axis & Bloom.

The customer received: "[coffee name from outboundRow.blend_id lookup]"
Their reply: "[inboundBody]"

Extract:
1. sentiment: "positive", "negative", or "neutral"
2. rating: integer 1–5 (1 = very unhappy, 3 = neutral/unclear, 5 = loved it). Infer from tone if not explicit.
3. descriptors: array of up to 5 flavor or experience words the customer mentioned (e.g. ["bitter", "too strong", "loved the chocolate notes"]). Empty array if nothing specific mentioned.

Rules:
- Short positive replies like "loved it", "amazing", "yes!" → sentiment positive, rating 5
- Short negative replies like "too bitter", "not for me", "didn't like" → sentiment negative, rating 2
- Ambiguous short replies like "ok", "it was fine" → sentiment neutral, rating 3

Respond with JSON only, no explanation: { "sentiment": "...", "rating": N, "descriptors": [] }
```

Use model `claude-haiku-4-5-20251001`. If JSON parsing fails, default to `{ sentiment: 'neutral', rating: 3, descriptors: [] }` and log `[liamSms] Haiku parse failed for inbound ${inboundId}`.

**Firestore document shape** — write to `users/{uid}/feedback_events/{auto-id}` using `firestoreDb` (named instance `axis-bloom-fs`). This subcollection follows the same pattern as the existing `users/{uid}/quiz_sessions` subcollection — do not create any new top-level collections.

```typescript
{
  orderId: outboundRow.order_id,       // SQL UUID as string
  blendId: outboundRow.blend_id,       // SQL UUID as string
  signalType: 'liam_sms',
  rating: parsedRating,                // 1–5
  sValue: (parsedRating - 1) / 4,     // 0.0–1.0 normalized
  confidence: 0.7,
  source: 'sms',
  sentiment: parsedSentiment,
  rawText: inboundBody,
  descriptors: parsedDescriptors,      // string[]
  liamSmsFeedbackId: inboundRowId,     // links back to SQL liam_sms_feedback row
  createdAt: FieldValue.serverTimestamp()
}
```

**Write sequence:**
1. Write to Firestore `users/{uid}/feedback_events` — capture the auto-generated Firestore doc ID
2. `UPDATE liam_sms_feedback SET haiku_parsed = true, parsed_signal_type = 'liam_sms', parsed_rating = $rating, parsed_sentiment = $sentiment, parsed_descriptors = $descriptors::jsonb, firestore_feedback_doc_id = $firestoreDocId WHERE id = $inboundRowId`

**If `parsedSentiment = 'negative'`:** merge into the existing `users/{uid}/confidence_profile` document (created by Task 1 — do not create a new collection or document path):
```typescript
await firestoreDb.doc(`users/${uid}/confidence_profile`).set({
  hasPendingNegativeFeedback: true,
  negativeFeedbackBlendId: outboundRow.blend_id,
  negativeFeedbackDetectedAt: FieldValue.serverTimestamp(),
  negativeFeedbackSource: 'liam_sms'
}, { merge: true });
```
The evaluator reads `confidence_profile` when classifying — this flag makes `RECOMMENDATION_MISS` fire on the next session without waiting for a full recompute.

**Always:** call `computeBehavioralConfidence(uid)` after writing. Fire-and-forget — don't block the webhook response.

---

## Step 4: Hook into order creation

Find the existing order creation handler (check `WHAT_WE_BUILT.md` for the file path — likely `backend/src/routes/orders.ts`). After a successful order insert:

```typescript
// Only schedule for orders 1 and 2
const orderCount = await db.query(
  'SELECT COUNT(*) FROM "order" WHERE user_id = $1',
  [uid]
);
if (parseInt(orderCount.rows[0].count) <= 2) {
  schedulePostDeliveryMessage(uid, orderId, blendId).catch(err => {
    console.error('[liamSms] schedule failed:', err);
  });
}
```

Fire-and-forget — never let SMS scheduling block the order response to the customer.

---

## Step 5: Cron endpoint + inbound webhook

### GET /api/cron/liam-sms-send

Add to `backend/src/routes/admin.ts` (or a new `cron.ts` routes file — follow existing patterns).

Auth: `requireCronSecret` middleware. Check header `x-cron-secret` against GCP Secret Manager secret `CRON_SECRET`. Return 401 if missing or wrong.

```typescript
router.get('/cron/liam-sms-send', requireCronSecret, async (req, res) => {
  const result = await processPendingMessages();
  res.json(result);
});
```

Cloud Scheduler job (note in comments, Claude Code does not create GCP resources): daily at 9:00 AM UTC, hits `GET https://[backend-url]/api/cron/liam-sms-send` with header `x-cron-secret: [secret]`.

### POST /api/webhooks/sms/inbound

No auth middleware — called by the SMS provider. Add a comment: `// TODO: validate Twilio X-Twilio-Signature when provider is wired`.

```typescript
router.post('/webhooks/sms/inbound', async (req, res) => {
  // Twilio sends form-encoded body: From, Body, MessageSid
  // Other providers will have different shapes — update parsing when provider is chosen
  const from = req.body.From as string;
  const body = req.body.Body as string;

  if (!from || !body) {
    return res.status(200).send(''); // Return 200 always — provider will retry on errors
  }

  // Find most recent matching outbound message
  const outbound = await db.query(`
    SELECT * FROM liam_sms_feedback
    WHERE phone_number = $1
      AND direction = 'outbound'
      AND status IN ('sent', 'delivered')
    ORDER BY sent_at DESC
    LIMIT 1
  `, [from]);

  if (!outbound.rows.length) {
    console.warn('[liamSms] inbound SMS from unknown number:', from);
    return res.status(200).send('');
  }

  const outboundRow = outbound.rows[0];

  // Insert inbound row
  const inbound = await db.query(`
    INSERT INTO liam_sms_feedback
      (user_id, order_id, blend_id, phone_number, direction, body, status, reply_to_id, sent_at)
    VALUES ($1, $2, $3, $4, 'inbound', $5, 'replied', $6, NOW())
    RETURNING id
  `, [outboundRow.user_id, outboundRow.order_id, outboundRow.blend_id, from, body, outboundRow.id]);

  // Mark outbound as replied
  await db.query(
    `UPDATE liam_sms_feedback SET status = 'replied' WHERE id = $1`,
    [outboundRow.id]
  );

  // Parse async — don't await (keep webhook response fast)
  parseInboundReply(body, outboundRow, inbound.rows[0].id).catch(err => {
    console.error('[liamSms] parseInboundReply failed:', err);
  });

  res.status(200).send('');
});
```

---

## Step 6: Profile settings — SMS opt-in (small UI addition)

Add to the Settings tab of `frontend/src/app/components/Profile.tsx`.

A single toggle row:
- **Label:** "Text updates from Liam"
- **Description:** "Receive a personal check-in from Liam after your deliveries."
- If user has no phone number on file: toggle is disabled, show "Add a phone number to enable this."
- Toggle calls `PATCH /api/users/profile` with `{ smsOptIn: boolean }`

Backend: in the existing profile update handler, write `sms_opt_in` and `sms_opt_in_at = NOW()` (on true) to the `user_phone` row for this user's primary phone.

---

## What NOT to change

- Sommelier chat flow (Tasks 1–4) — this is a separate channel
- `behavioralConfidence.ts` computation logic — only call it, don't modify it
- `sommelierEvaluator.ts` trigger rules — `RECOMMENDATION_MISS` already handles negative feedback; just write the Firestore flag correctly
- Order response to customer — SMS scheduling is always fire-and-forget

---

## Before you finish: update documentation

Append a summary to `SOMMELIER_BUILT.md` under "Issues and Decisions". Include: how you found and hooked into order creation, any schema differences from what's listed here, Haiku prompt iterations, how you handled the message length limit.

---

## Definition of done

- [ ] `sms_opt_in`, `sms_opt_in_at` added to `user_phone` (idempotent ALTER)
- [ ] `liam_sms_feedback` table + indexes in `schema.sql`
- [ ] `smsProvider.ts` — placeholder, returns `SMS_PROVIDER_NOT_CONFIGURED`, logs to `notification_log`
- [ ] `liamSmsFeedback.ts` — `schedulePostDeliveryMessage()`, `processPendingMessages()`, `parseInboundReply()`
- [ ] Order hook — only for orders 1 and 2, fire-and-forget, never blocks order response
- [ ] `GET /api/cron/liam-sms-send` — cron secret auth, returns `{ processed, sent, failed }`
- [ ] `POST /api/webhooks/sms/inbound` — finds outbound, inserts inbound row, parses async, always returns 200
- [ ] Haiku parsing with JSON fallback on failure
- [ ] Negative sentiment → Firestore `feedbackFlags.hasPendingNegativeFeedback` written
- [ ] `computeBehavioralConfidence()` called after every parsed reply (fire-and-forget)
- [ ] `notification_log` row written for every outbound SMS attempt
- [ ] Profile settings toggle (UI + PATCH handler for `sms_opt_in`)
