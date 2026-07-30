import { Router, type Request, type Response, type NextFunction } from 'express';
import { Resend } from 'resend';
import { db } from '../db/client.js';
import { processPendingMessages, parseInboundReply } from '../services/liamSmsFeedback.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { purgeStaleAnonymousGuests } from '../services/staleGuestCleanup.js';

const resend = new Resend(process.env.RESEND_API_KEY);

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

// ── GET /api/cron/expire-company-gift-codes ──────────────────────────────────
// Daily sweep: flips unredeemed codes past their parent gift's code_redeem_by to
// 'expired'. Purely for admin-dashboard reporting clarity — the redemption endpoint's
// own deadline check is what actually blocks a late redemption; this just keeps the
// code list from looking misleadingly "still available".
router.get('/expire-company-gift-codes', requireCronSecret, async (_req, res) => {
  try {
    const r = await db.query(
      `UPDATE company_gift_code cgc
       SET status = 'expired'
       FROM company_gift cg
       WHERE cgc.company_gift_id = cg.id
         AND cgc.status = 'unredeemed'
         AND cg.code_redeem_by IS NOT NULL
         AND cg.code_redeem_by < CURRENT_DATE
       RETURNING cgc.id`
    );
    res.json({ expiredCount: r.rowCount });
  } catch (err) {
    console.error('[cron/expire-company-gift-codes]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

// ── GET /api/cron/sponsored-subscription-check ───────────────────────────────
// Daily job (Phase 3 of the Company Gift task): flips expired sponsored
// subscriptions to 'lapsed' and flags anyone entering the trial-ending warning
// window — both drive user_lifecycle_state via refreshLifecycleState(), and a
// one-time transactional email fires only on the actual stage transition (never
// re-sent on a later run once the user is already sitting in that stage).
//
// NOTE: the email CTA links to /profile (Settings tab) as the nearest existing
// account surface — there is no live "add a payment method / continue as a paid
// subscriber" checkout flow yet (Shopify checkout isn't wired, per
// WHAT_WE_BUILT.md). Swap this link for the real flow once it exists; this is a
// deliberate placeholder per the task spec's explicit instruction not to build a
// second parallel checkout.
router.get('/sponsored-subscription-check', requireCronSecret, async (_req, res) => {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  let lapsedCount = 0;
  let trialEndingCount = 0;

  try {
    // ── Flip expired active sponsorships to 'lapsed' ──────────────────────────
    const expiredResult = await db.query(
      `SELECT s.id AS subscription_id, up.firebase_uid, up.first_name, ue.email_address
       FROM subscription s
       JOIN user_profile up ON up.id = s.user_id
       LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
       WHERE s.company_gift_id IS NOT NULL AND s.status = 'active' AND s.sponsored_expires_at < now()`
    );
    for (const row of expiredResult.rows) {
      await db.query(`UPDATE subscription SET status = 'lapsed', updated_at = now() WHERE id = $1`, [row.subscription_id]);
      const result = await refreshLifecycleState(row.firebase_uid);
      if (result?.transitioned && result.stageCode === 'SPONSORED_LAPSED_NO_PAYMENT') {
        lapsedCount++;
        if (row.email_address) {
          try {
            await resend.emails.send({
              from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
              to: row.email_address,
              subject: 'Your sponsored Axis & Bloom subscription has ended',
              html: buildSponsoredLapsedEmail(row.first_name, `${frontendUrl}/profile`),
            });
          } catch (err) {
            console.error('[cron/sponsored-subscription-check] lapsed email failed:', err);
          }
        }
      }
    }

    // ── Flag active sponsorships entering the trial-ending warning window ────
    const endingSoonResult = await db.query(
      `SELECT up.firebase_uid, up.first_name, ue.email_address
       FROM subscription s
       JOIN user_profile up ON up.id = s.user_id
       LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
       WHERE s.company_gift_id IS NOT NULL AND s.status = 'active'
         AND s.sponsored_expires_at >= now() AND s.sponsored_expires_at < now() + interval '14 days'`
    );
    for (const row of endingSoonResult.rows) {
      const result = await refreshLifecycleState(row.firebase_uid);
      if (result?.transitioned && result.stageCode === 'SPONSORED_TRIAL_ENDING') {
        trialEndingCount++;
        if (row.email_address) {
          try {
            await resend.emails.send({
              from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
              to: row.email_address,
              subject: 'Your sponsored Axis & Bloom subscription is ending soon',
              html: buildSponsoredTrialEndingEmail(row.first_name, `${frontendUrl}/profile`),
            });
          } catch (err) {
            console.error('[cron/sponsored-subscription-check] trial-ending email failed:', err);
          }
        }
      }
    }

    res.json({ lapsedCount, trialEndingCount });
  } catch (err) {
    console.error('[cron/sponsored-subscription-check]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

// ── GET /api/cron/purge-stale-anonymous-guests ────────────────────────────
// Daily sweep. No auto-cleanup exists on our Firebase Auth tier (that's an
// Identity Platform feature we don't have), so anonymous identities from
// guest browsing, incognito sessions, and multi-device visits would
// otherwise accumulate in Auth/Postgres/Firestore forever. See
// backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_IDENTITY_FOLLOWUP_NAV_AND_CLEANUP.md
router.get('/purge-stale-anonymous-guests', requireCronSecret, async (_req, res) => {
  try {
    const result = await purgeStaleAnonymousGuests();
    res.json(result);
  } catch (err) {
    console.error('[cron/purge-stale-anonymous-guests]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

function buildSponsoredTrialEndingEmail(firstName: string | null, profileLink: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f2f1ea;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ea;padding:48px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:48px;">
          <tr>
            <td style="padding-bottom:32px;border-bottom:1px solid #e8e4dc;">
              <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#a33726;font-family:Georgia,serif;">
                Axis &amp; Bloom
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 0 24px;">
              <h1 style="margin:0;font-size:32px;font-weight:400;color:#a33726;line-height:1.2;font-family:Georgia,serif;">
                Your gift is ending soon.
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                ${greeting} the sponsored subscription your employer gifted you is coming to an end soon.
                We'd love to keep sending you coffee matched to your palate — add a payment method
                to continue as a subscriber, no interruption to your deliveries.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:40px;">
              <a href="${profileLink}"
                 style="display:inline-block;padding:14px 32px;background:#a33726;color:#ffffff;
                        text-decoration:none;font-size:11px;letter-spacing:0.2em;
                        text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;">
                Continue My Subscription
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                If you'd rather not continue, there's nothing you need to do — your gifted subscription
                will simply end on schedule.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildSponsoredLapsedEmail(firstName: string | null, profileLink: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f2f1ea;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ea;padding:48px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:48px;">
          <tr>
            <td style="padding-bottom:32px;border-bottom:1px solid #e8e4dc;">
              <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#a33726;font-family:Georgia,serif;">
                Axis &amp; Bloom
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 0 24px;">
              <h1 style="margin:0;font-size:32px;font-weight:400;color:#a33726;line-height:1.2;font-family:Georgia,serif;">
                Your gift has come to an end.
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                ${greeting} the sponsored subscription your employer gifted you has ended.
                Your taste profile is still here whenever you're ready — add a payment method to
                pick up right where you left off, no quiz needed.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:40px;">
              <a href="${profileLink}"
                 style="display:inline-block;padding:14px 32px;background:#a33726;color:#ffffff;
                        text-decoration:none;font-size:11px;letter-spacing:0.2em;
                        text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;">
                Continue My Subscription
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                No action needed if you'd rather not continue — there's nothing further to cancel.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

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
