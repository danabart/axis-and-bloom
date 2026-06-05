import { Router } from 'express';
import { Resend } from 'resend';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import admin from '../services/firebase-admin.js';
import { db } from '../db/client.js';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// ─── POST /api/auth/sync ─────────────────────────────────────────────────────
// Called after Firebase sign-in/sign-up to sync user to our DB
router.post('/sync', requireAuth, async (req: AuthRequest, res) => {
  const { firstName, lastName } = req.body ?? {};
  try {
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO UPDATE SET
         first_name = COALESCE($2, user_profile.first_name),
         last_name  = COALESCE($3, user_profile.last_name),
         updated_at = NOW()
       RETURNING id`,
      [req.uid, firstName || null, lastName || null]
    );
    const profileId = profileResult.rows[0].id;

    if (req.email) {
      await db.query(
        `INSERT INTO user_email (user_id, email_address, is_primary, is_verified)
         VALUES ($1, $2, true, true)
         ON CONFLICT (email_address) DO NOTHING`,
        [profileId, req.email]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/sync]', err);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
// Generates a Firebase password-reset link and delivers it via Resend
// so the email comes from noreply@axisandbloomcoffee.com (not firebaseapp.com)
router.post('/reset-password', async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email required' });
    return;
  }

  try {
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    await resend.emails.send({
      from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
      to: email,
      subject: 'Reset your Axis & Bloom password',
      html: `
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
                Reset your password.
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                We received a request to reset the password for your Axis &amp; Bloom account.
                Click the button below to choose a new one. This link expires in 1 hour.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom:40px;">
              <a href="${resetLink}"
                 style="display:inline-block;padding:14px 32px;background:#a33726;color:#ffffff;
                        text-decoration:none;font-size:11px;letter-spacing:0.2em;
                        text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;">
                Reset Password
              </a>
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                If you didn't request a password reset, you can safely ignore this email.
                Your password will not change.<br/><br/>
                Having trouble with the button?
                <a href="${resetLink}" style="color:#a33726;">Copy this link</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    });

    res.json({ ok: true });
  } catch (err: any) {
    // Don't reveal whether the email exists (prevents enumeration)
    if (err?.code === 'auth/user-not-found' || err?.errorInfo?.code === 'auth/user-not-found') {
      res.json({ ok: true });
      return;
    }
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

export default router;
