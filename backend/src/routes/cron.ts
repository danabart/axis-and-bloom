import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db/client.js';
import { processPendingMessages, parseInboundReply } from '../services/liamSmsFeedback.js';

const router = Router();

// Validate x-cron-secret header against CRON_SECRET env var (set via GCP Secret Manager).
// Cloud Scheduler job: daily 9:00 AM UTC → GET /api/cron/liam-sms-send
// with header x-cron-secret: [secret value from Secret Manager CRON_SECRET].
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── GET /api/cron/liam-sms-send ──────────────────────────────────────────────
router.get('/liam-sms-send', requireCronSecret, async (_req, res) => {
  try {
    const result = await processPendingMessages();
    res.json(result);
  } catch (err) {
    console.error('[cron/liam-sms-send]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

// ── POST /api/webhooks/sms/inbound ───────────────────────────────────────────
// No auth — called by the SMS provider.
// TODO: validate Twilio X-Twilio-Signature when provider is wired.
// Twilio sends form-encoded body: From, Body, MessageSid.
// Other providers will have different shapes — update parsing when provider is chosen.
router.post('/webhooks/sms/inbound', async (req, res) => {
  const from = req.body?.From as string | undefined;
  const body = req.body?.Body as string | undefined;

  if (!from || !body) {
    res.status(200).send('');
    return;
  }

  try {
    // Find most recent matching outbound message
    const outboundResult = await db.query<{
      id: string;
      user_id: string;
      order_id: string | null;
      blend_id: string | null;
    }>(
      `SELECT id, user_id, order_id, blend_id
       FROM sommelier_sms_feedback
       WHERE phone_number = $1
         AND direction = 'outbound'
         AND status IN ('sent', 'delivered')
       ORDER BY sent_at DESC
       LIMIT 1`,
      [from]
    );

    if (!outboundResult.rows.length) {
      console.warn('[liamSms] inbound SMS from unknown number:', from);
      res.status(200).send('');
      return;
    }

    const outboundRow = outboundResult.rows[0];

    // Insert inbound row
    const inboundResult = await db.query<{ id: string }>(
      `INSERT INTO sommelier_sms_feedback
         (user_id, order_id, blend_id, phone_number, direction, body, status, reply_to_id, sent_at)
       VALUES ($1, $2, $3, $4, 'inbound', $5, 'replied', $6, NOW())
       RETURNING id`,
      [outboundRow.user_id, outboundRow.order_id, outboundRow.blend_id, from, body, outboundRow.id]
    );

    // Mark outbound as replied
    await db.query(
      `UPDATE sommelier_sms_feedback SET status = 'replied' WHERE id = $1`,
      [outboundRow.id]
    );

    // Parse async — don't await
    parseInboundReply(body, outboundRow, inboundResult.rows[0].id).catch(err => {
      console.error('[liamSms] parseInboundReply failed:', err);
    });
  } catch (err) {
    console.error('[webhooks/sms/inbound]', err);
  }

  // Always return 200 — provider will retry on non-200
  res.status(200).send('');
});

export default router;
