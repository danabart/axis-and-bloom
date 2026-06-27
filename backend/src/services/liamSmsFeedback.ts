import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from './firebase-admin.js';
import { sendSms, logToNotificationLog } from './smsProvider.js';
import { computeBehavioralConfidence } from './behavioralConfidence.js';

const anthropic = new Anthropic();

// ── schedulePostDeliveryMessage ───────────────────────────────────────────────
// Called after order placement for orders 1 and 2. Never throws.
export async function schedulePostDeliveryMessage(
  firebaseUid: string,
  blendId: string | null
): Promise<void> {
  try {
    // Look up user_profile
    const profileResult = await db.query(
      `SELECT id, first_name FROM user_profile WHERE firebase_uid = $1`,
      [firebaseUid]
    );
    if (!profileResult.rows.length) return;
    const { id: userId, first_name: firstName } = profileResult.rows[0];

    // Check SMS opt-in
    const phoneResult = await db.query(
      `SELECT phone_number FROM user_phone
       WHERE user_id = $1 AND sms_opt_in = true LIMIT 1`,
      [userId]
    );
    if (!phoneResult.rows.length) {
      console.log('[liamSms] no opted-in phone for user:', userId);
      return;
    }
    const phoneNumber = phoneResult.rows[0].phone_number as string;

    // Idempotency: only one outbound per blend per user
    if (blendId) {
      const existing = await db.query(
        `SELECT id FROM sommelier_sms_feedback
         WHERE user_id = $1 AND blend_id = $2 AND direction = 'outbound'`,
        [userId, blendId]
      );
      if (existing.rows.length) return;
    }

    // Get blend name if available
    let coffeeName = 'your latest coffee';
    if (blendId) {
      const blendResult = await db.query(
        `SELECT blend_name FROM roaster_blend WHERE id = $1`,
        [blendId]
      );
      if (blendResult.rows.length) coffeeName = blendResult.rows[0].blend_name as string;
    }

    const name = firstName ? firstName.trim() : '';
    const primary = `Hey ${name}! It's Liam from Axis & Bloom — how are you finding the ${coffeeName}? Any thoughts welcome 🌸`;
    const fallback = `Hey ${name}, it's Liam from Axis & Bloom! How's the ${coffeeName} treating you? Any thoughts?`;
    const body = primary.length <= 160 ? primary : fallback;

    await db.query(
      `INSERT INTO sommelier_sms_feedback
         (user_id, blend_id, phone_number, direction, body, status, scheduled_for)
       VALUES ($1, $2, $3, 'outbound', $4, 'scheduled', NOW() + INTERVAL '10 days')`,
      [userId, blendId ?? null, phoneNumber, body]
    );

    console.log('[liamSms] scheduled message for user:', userId, 'in 10 days');
  } catch (err) {
    console.error('[liamSms] schedulePostDeliveryMessage error:', err);
  }
}

// ── processPendingMessages ────────────────────────────────────────────────────
// Called by daily cron. Returns counts.
export async function processPendingMessages(): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const due = await db.query<{
    id: string;
    user_id: string;
    phone_number: string;
    body: string;
    blend_id: string | null;
  }>(
    `SELECT lsf.id, lsf.user_id, lsf.phone_number, lsf.body, lsf.blend_id
     FROM sommelier_sms_feedback lsf
     WHERE lsf.direction = 'outbound'
       AND lsf.status = 'scheduled'
       AND lsf.scheduled_for <= NOW()
     ORDER BY lsf.scheduled_for ASC
     LIMIT 100`
  );

  let sent = 0;
  let failed = 0;

  for (const row of due.rows) {
    const result = await sendSms({ to: row.phone_number, body: row.body });

    if (result.success) {
      await db.query(
        `UPDATE sommelier_sms_feedback
         SET status = 'sent', sent_at = NOW(), provider_message_id = $2
         WHERE id = $1`,
        [row.id, result.providerMessageId ?? null]
      );
      sent++;
    } else {
      await db.query(
        `UPDATE sommelier_sms_feedback SET status = 'failed' WHERE id = $1`,
        [row.id]
      );
      failed++;
    }

    await logToNotificationLog({
      userId: row.user_id,
      channel: 'sms',
      messageType: 'liam_feedback_request',
      recipientContact: row.phone_number,
      deliveryStatus: result.success ? 'sent' : 'failed',
      externalProviderId: result.providerMessageId ?? null,
      metadata: { liamSmsFeedbackId: row.id },
    });
  }

  return { processed: due.rows.length, sent, failed };
}

// ── parseInboundReply ─────────────────────────────────────────────────────────
// Called async after webhook inserts inbound row. Never blocks the webhook response.
export async function parseInboundReply(
  inboundBody: string,
  outboundRow: { id: string; user_id: string; blend_id: string | null },
  inboundRowId: string
): Promise<void> {
  // Look up firebase UID and blend name for Haiku prompt
  const profileResult = await db.query(
    `SELECT firebase_uid FROM user_profile WHERE id = $1`,
    [outboundRow.user_id]
  );
  const uid = profileResult.rows[0]?.firebase_uid as string | undefined;
  if (!uid) {
    console.error('[liamSms] no firebase_uid for user_id:', outboundRow.user_id);
    return;
  }

  let coffeeName = 'the coffee';
  if (outboundRow.blend_id) {
    const blendResult = await db.query(
      `SELECT blend_name FROM roaster_blend WHERE id = $1`,
      [outboundRow.blend_id]
    );
    if (blendResult.rows.length) coffeeName = blendResult.rows[0].blend_name as string;
  }

  // Haiku parsing
  let parsedSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
  let parsedRating = 3;
  let parsedDescriptors: string[] = [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are parsing a coffee feedback SMS reply for Axis & Bloom.

The customer received: "${coffeeName}"
Their reply: "${inboundBody}"

Extract:
1. sentiment: "positive", "negative", or "neutral"
2. rating: integer 1–5 (1 = very unhappy, 3 = neutral/unclear, 5 = loved it). Infer from tone if not explicit.
3. descriptors: array of up to 5 flavor or experience words the customer mentioned (e.g. ["bitter", "too strong", "loved the chocolate notes"]). Empty array if nothing specific mentioned.

Rules:
- Short positive replies like "loved it", "amazing", "yes!" → sentiment positive, rating 5
- Short negative replies like "too bitter", "not for me", "didn't like" → sentiment negative, rating 2
- Ambiguous short replies like "ok", "it was fine" → sentiment neutral, rating 3

Respond with JSON only, no explanation: { "sentiment": "...", "rating": N, "descriptors": [] }`,
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(raw);
    parsedSentiment = parsed.sentiment ?? 'neutral';
    parsedRating = typeof parsed.rating === 'number' ? Math.min(5, Math.max(1, parsed.rating)) : 3;
    parsedDescriptors = Array.isArray(parsed.descriptors) ? parsed.descriptors : [];
  } catch (err) {
    console.error('[liamSms] Haiku parse failed for inbound', inboundRowId, err);
  }

  const sValue = (parsedRating - 1) / 4;

  // Write to Firestore users/{uid}/feedback_events
  let firestoreDocId: string | null = null;
  try {
    const docRef = await firestoreDb
      .collection(`users/${uid}/feedback_events`)
      .add({
        blendId:            outboundRow.blend_id ?? null,
        signalType:         'liam_sms',
        rating:             parsedRating,
        sValue,
        confidence:         0.7,
        source:             'sms',
        sentiment:          parsedSentiment,
        rawText:            inboundBody,
        descriptors:        parsedDescriptors,
        liamSmsFeedbackId:  inboundRowId,
        createdAt:          FieldValue.serverTimestamp(),
      });
    firestoreDocId = docRef.id;
  } catch (err) {
    console.error('[liamSms] Firestore feedback_events write failed:', err);
  }

  // Update SQL row
  await db.query(
    `UPDATE sommelier_sms_feedback
     SET haiku_parsed = true,
         parsed_signal_type = 'liam_sms',
         parsed_rating = $2,
         parsed_sentiment = $3,
         parsed_descriptors = $4::jsonb,
         firestore_feedback_doc_id = $5
     WHERE id = $1`,
    [inboundRowId, parsedRating, parsedSentiment, JSON.stringify(parsedDescriptors), firestoreDocId]
  );

  // If negative: flag confidence_profile so RECOMMENDATION_MISS fires on next session
  if (parsedSentiment === 'negative') {
    try {
      await firestoreDb.doc(`users/${uid}/confidence_profile`).set({
        hasPendingNegativeFeedback:   true,
        negativeFeedbackBlendId:      outboundRow.blend_id ?? null,
        negativeFeedbackDetectedAt:   FieldValue.serverTimestamp(),
        negativeFeedbackSource:       'liam_sms',
      }, { merge: true });
    } catch (err) {
      console.error('[liamSms] confidence_profile update failed:', err);
    }
  }

  // Recompute behavioral confidence — fire-and-forget
  computeBehavioralConfidence(uid).catch(err =>
    console.error('[liamSms] computeBehavioralConfidence failed:', err)
  );
}
