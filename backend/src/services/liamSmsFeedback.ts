import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from './firebase-admin.js';
import { sendSms, logToNotificationLog } from './smsProvider.js';
import { computeBehavioralConfidence } from './behavioralConfidence.js';
import { refreshLifecycleState } from './userLifecycle.js';
import { writeDialPositionSignal } from './dialPositionSignal.js';
import { guardClaudeCall } from './anthropicGuard.js';

const anthropic = new Anthropic();

// ── schedulePostDeliveryMessage ───────────────────────────────────────────────
// HOME_TASK_8 (§3.1) SUPERSEDE NOTE: as of this task, orders.ts no longer
// calls this function — every new order goes through the beat engine's own
// dial_in beat instead (beatEngine.ts), which asks the same kind of
// lighter/bolder question at its own timing and also adjusts the customer's
// brew card. This function, processPendingMessages(), and the inbound-reply
// parsing below are all left exactly as they were — sommelier_sms_feedback
// rows scheduled before this deploy still process normally, and this remains
// the reusable scheduling/parsing machinery the dial_in beat's own (currently
// SMS-gated-off) send path is built on top of, not a duplicate of it.
// Called after order placement for orders 1 and 2. Never throws.
export async function schedulePostDeliveryMessage(
  firebaseUid: string,
  blendId: string | null,
  orderId: string | null = null
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

    // Liam SMS Dial Question: channel parity with on-site feedback v2 — both
    // now ask the same closed dial-direction question ("lighter or bolder than
    // expected") so both channels can populate dial_position_signal. Customer
    // language, not the dimension name (per SOMMELIER_TASK_6_VOICE.md). The
    // question is never dropped for length — only the greeting shortens.
    const name = firstName ? firstName.trim() : '';
    const primary = `Hey ${name}! It's Liam from Axis & Bloom — how are you finding the ${coffeeName}? Lighter or bolder than you expected? 🌸`;
    const fallback = `Hi ${name}, it's Liam — how's the ${coffeeName}? Lighter or bolder than expected?`;
    const body = primary.length <= 160 ? primary : fallback;

    await db.query(
      `INSERT INTO sommelier_sms_feedback
         (user_id, order_id, blend_id, phone_number, direction, body, status, scheduled_for)
       VALUES ($1, $2, $3, $4, 'outbound', $5, 'scheduled', NOW() + INTERVAL '10 days')`,
      [userId, orderId, blendId ?? null, phoneNumber, body]
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
// HOME_TASK_8 — now returns the parsed `expectation` (additive; every existing
// caller already ignored the previous void return) so the webhook can route a
// beat-originated reply into respondToDialInBeat() afterward, without this
// function knowing anything about beats itself — reused, not duplicated.
export async function parseInboundReply(
  inboundBody: string,
  outboundRow: { id: string; user_id: string; order_id: string | null; blend_id: string | null },
  inboundRowId: string
): Promise<{ expectation: 'lighter' | 'as_expected' | 'bolder' | null }> {
  // Look up firebase UID and blend name for Haiku prompt
  const profileResult = await db.query(
    `SELECT firebase_uid FROM user_profile WHERE id = $1`,
    [outboundRow.user_id]
  );
  const uid = profileResult.rows[0]?.firebase_uid as string | undefined;
  if (!uid) {
    console.error('[liamSms] no firebase_uid for user_id:', outboundRow.user_id);
    return { expectation: null };
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
  let parsedExpectation: 'lighter' | 'as_expected' | 'bolder' | null = null;

  try {
    const response = await guardClaudeCall('lifecycle', 'claude-haiku-4-5-20251001', () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are parsing a coffee feedback SMS reply for Axis & Bloom.

The customer received: "${coffeeName}"
They were asked how they're finding it, and whether it was lighter or bolder than expected.
Their reply: "${inboundBody}"

Extract:
1. sentiment: "positive", "negative", or "neutral"
2. rating: integer 1–5 (1 = very unhappy, 3 = neutral/unclear, 5 = loved it). Infer from tone if not explicit.
3. descriptors: array of up to 5 flavor or experience words the customer mentioned (e.g. ["bitter", "too strong", "loved the chocolate notes"]). Empty array if nothing specific mentioned.
4. expectation: "lighter", "as_expected", or "bolder" — only if the reply actually addresses the lighter/bolder question (directly or via a clear synonym, e.g. "weak"→lighter, "strong"/"intense"→bolder, "spot on"/"as expected"→as_expected). Use null if the reply doesn't address it at all — never guess.

Rules:
- Short positive replies like "loved it", "amazing", "yes!" → sentiment positive, rating 5
- Short negative replies like "too bitter", "not for me", "didn't like" → sentiment negative, rating 2
- Ambiguous short replies like "ok", "it was fine" → sentiment neutral, rating 3

Respond with JSON only, no explanation: { "sentiment": "...", "rating": N, "descriptors": [], "expectation": "..." or null }`,
        },
      ],
    }));

    // Haiku frequently wraps its JSON in ```json ... ``` fences despite the
    // "no explanation" instruction (confirmed live, not theoretical — every
    // sample reply during Liam SMS Dial Question testing came back fenced).
    // Unguarded JSON.parse would throw on every real reply, silently falling
    // back to sentiment=neutral/rating=3/descriptors=[] for all of them, not
    // just the new expectation field — a live bug this task's testing surfaced,
    // fixed here rather than left in place.
    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    parsedSentiment = parsed.sentiment ?? 'neutral';
    parsedRating = typeof parsed.rating === 'number' ? Math.min(5, Math.max(1, parsed.rating)) : 3;
    parsedDescriptors = Array.isArray(parsed.descriptors) ? parsed.descriptors : [];
    parsedExpectation = ['lighter', 'as_expected', 'bolder'].includes(parsed.expectation) ? parsed.expectation : null;
  } catch (err) {
    console.error('[liamSms] Haiku parse failed for inbound', inboundRowId, err);
  }

  const sValue = (parsedRating - 1) / 4;

  // Write to Firestore users/{uid}/feedback_events — includes `expectation`
  // (Liam SMS Dial Question), same field name on-site v2 writes, so every
  // downstream consumer of feedback_events treats the two channels
  // interchangeably.
  let firestoreDocId: string | null = null;
  try {
    const docRef = await firestoreDb
      .collection(`users/${uid}/feedback_events`)
      .add({
        orderId:            outboundRow.order_id ?? null,
        blendId:            outboundRow.blend_id ?? null,
        signalType:         'liam_sms',
        rating:             parsedRating,
        sValue,
        confidence:         0.7,
        source:             'sms',
        sentiment:          parsedSentiment,
        rawText:            inboundBody,
        descriptors:        parsedDescriptors,
        expectation:        parsedExpectation,
        liamSmsFeedbackId:  inboundRowId,
        createdAt:          FieldValue.serverTimestamp(),
      });
    firestoreDocId = docRef.id;
  } catch (err) {
    console.error('[liamSms] Firestore feedback_events write failed:', err);
  }

  // dial_position_signal — same resolution dialPositionSignal.ts already does
  // for on-site feedback (Profile Part 2), reused here rather than duplicated.
  // as_expected/null writes nothing (writeDialPositionSignal's own rule).
  if (outboundRow.blend_id) {
    try {
      const blendResult = await db.query(
        `SELECT coffee_id FROM roaster_blend WHERE id = $1`,
        [outboundRow.blend_id]
      );
      const coffeeId: number | undefined = blendResult.rows[0]?.coffee_id;
      if (coffeeId) {
        await writeDialPositionSignal({
          coffeeId,
          expectation: parsedExpectation,
          source: 'sms_feedback',
          notes: `sms feedback for order ${outboundRow.order_id ?? 'unknown'}`,
        });
      }
    } catch (err) {
      console.error('[liamSms] dial_position_signal write failed:', err);
    }
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
      await firestoreDb.doc(`users/${uid}/metadata/confidence_profile`).set({
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

  // Recompute lifecycle stage — independent write, same trigger point
  refreshLifecycleState(uid).catch(err =>
    console.error('[liamSms] refreshLifecycleState failed:', err)
  );

  return { expectation: parsedExpectation };
}
