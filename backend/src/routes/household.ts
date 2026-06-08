import { Router } from 'express';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

async function getProfile(uid: string) {
  const r = await db.query(
    `SELECT up.id, up.first_name, up.last_name, up.household_id, up.is_household_admin,
            ue.email_address AS email
     FROM user_profile up
     LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
     WHERE up.firebase_uid = $1`,
    [uid]
  );
  return r.rows[0] ?? null;
}

// POST /api/household/create
router.post('/create', requireAuth, async (req: AuthRequest, res) => {
  const { householdName } = req.body as { householdName?: string };
  try {
    const profile = await getProfile(req.uid!);
    if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }
    if (profile.household_id) { res.status(409).json({ error: 'Already in a household' }); return; }

    const hhResult = await db.query(
      `INSERT INTO household (household_name, primary_billing_user_id)
       VALUES ($1, $2) RETURNING id, household_name, created_at`,
      [householdName?.trim() || null, profile.id]
    );
    const household = hhResult.rows[0];

    await db.query(
      `UPDATE user_profile SET household_id = $1, is_household_admin = true WHERE id = $2`,
      [household.id, profile.id]
    );

    res.json({ id: household.id, name: household.household_name, createdAt: household.created_at });
  } catch (err) {
    console.error('[household/create]', err);
    res.status(500).json({ error: 'Failed to create household' });
  }
});

// GET /api/household/mine
router.get('/mine', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profile = await getProfile(req.uid!);
    if (!profile?.household_id) { res.json(null); return; }

    const [hhResult, membersResult, invitesResult] = await Promise.all([
      db.query(`SELECT id, household_name, created_at FROM household WHERE id = $1`, [profile.household_id]),
      db.query(
        `SELECT up.id, up.first_name, up.last_name, up.is_household_admin,
                ue.email_address AS email
         FROM user_profile up
         LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
         WHERE up.household_id = $1
         ORDER BY up.is_household_admin DESC, up.created_at ASC`,
        [profile.household_id]
      ),
      db.query(
        `SELECT id, invited_email, status, created_at, expires_at
         FROM household_invitation
         WHERE household_id = $1 AND status = 'pending'
         ORDER BY created_at DESC`,
        [profile.household_id]
      ),
    ]);

    const hh = hhResult.rows[0];
    res.json({
      id: hh.id,
      name: hh.household_name,
      createdAt: hh.created_at,
      isAdmin: profile.is_household_admin,
      members: membersResult.rows,
      pendingInvites: invitesResult.rows,
    });
  } catch (err) {
    console.error('[household/mine]', err);
    res.status(500).json({ error: 'Failed to fetch household' });
  }
});

// POST /api/household/invite
router.post('/invite', requireAuth, async (req: AuthRequest, res) => {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'Email required' }); return; }

  try {
    const profile = await getProfile(req.uid!);
    if (!profile?.household_id) { res.status(403).json({ error: 'Not in a household' }); return; }
    if (!profile.is_household_admin) { res.status(403).json({ error: 'Only household admins can invite' }); return; }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await db.query(
      `SELECT up.id FROM user_profile up
       JOIN user_email ue ON ue.user_id = up.id
       WHERE ue.email_address = $1 AND up.household_id = $2`,
      [normalizedEmail, profile.household_id]
    );
    if (existing.rows.length) {
      res.status(409).json({ error: 'This person is already in your household' });
      return;
    }

    await db.query(
      `UPDATE household_invitation SET status = 'cancelled'
       WHERE household_id = $1 AND invited_email = $2 AND status = 'pending'`,
      [profile.household_id, normalizedEmail]
    );

    const token = randomBytes(32).toString('hex');
    const inviteResult = await db.query(
      `INSERT INTO household_invitation (household_id, invited_email, invited_by_id, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, invited_email, expires_at`,
      [profile.household_id, normalizedEmail, profile.id, token]
    );
    const invite = inviteResult.rows[0];

    const hhResult = await db.query(`SELECT household_name FROM household WHERE id = $1`, [profile.household_id]);
    const hhName = hhResult.rows[0]?.household_name || 'a Family Bundle';
    const inviterName = profile.first_name
      ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}`
      : (profile.email ?? 'Someone');

    const joinLink = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/join-household?token=${token}`;

    await resend.emails.send({
      from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
      to: normalizedEmail,
      subject: `${inviterName} invited you to a Family Bundle`,
      html: buildInviteEmail(inviterName, hhName, joinLink),
    });

    res.json({ id: invite.id, invitedEmail: invite.invited_email, expiresAt: invite.expires_at });
  } catch (err) {
    console.error('[household/invite]', err);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// DELETE /api/household/leave
router.delete('/leave', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profile = await getProfile(req.uid!);
    if (!profile?.household_id) { res.status(400).json({ error: 'Not in a household' }); return; }

    if (profile.is_household_admin) {
      const otherMembers = await db.query(
        `SELECT id FROM user_profile WHERE household_id = $1 AND id != $2`,
        [profile.household_id, profile.id]
      );
      if (otherMembers.rows.length > 0) {
        res.status(403).json({ error: 'Remove all members before leaving as admin' });
        return;
      }
      // Only member — clear household_id first to avoid FK violation, then delete
      await db.query(
        `UPDATE user_profile SET household_id = NULL, is_household_admin = false WHERE id = $1`,
        [profile.id]
      );
      await db.query(`DELETE FROM household WHERE id = $1`, [profile.household_id]);
    } else {
      await db.query(
        `UPDATE user_profile SET household_id = NULL, is_household_admin = false WHERE id = $1`,
        [profile.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[household/leave]', err);
    res.status(500).json({ error: 'Failed to leave household' });
  }
});

// DELETE /api/household/members/:userId
router.delete('/members/:userId', requireAuth, async (req: AuthRequest, res) => {
  const { userId } = req.params;
  try {
    const profile = await getProfile(req.uid!);
    if (!profile?.household_id) { res.status(403).json({ error: 'Not in a household' }); return; }
    if (!profile.is_household_admin) { res.status(403).json({ error: 'Admin only' }); return; }
    if (userId === profile.id) { res.status(400).json({ error: 'Cannot remove yourself' }); return; }

    await db.query(
      `UPDATE user_profile SET household_id = NULL, is_household_admin = false
       WHERE id = $1 AND household_id = $2`,
      [userId, profile.household_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[household/members/remove]', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// GET /api/household/invite/:token  (public — for join page)
router.get('/invite/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const r = await db.query(
      `SELECT hi.id, hi.invited_email, hi.status, hi.expires_at,
              h.household_name,
              up.first_name AS inviter_first, up.last_name AS inviter_last,
              ue.email_address AS inviter_email
       FROM household_invitation hi
       JOIN household h      ON h.id  = hi.household_id
       JOIN user_profile up  ON up.id = hi.invited_by_id
       LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
       WHERE hi.token = $1`,
      [token]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Invitation not found' }); return; }
    const row = r.rows[0];
    if (row.status !== 'pending') {
      res.status(410).json({ error: 'Invitation already used or cancelled', status: row.status });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(410).json({ error: 'Invitation expired', status: 'expired' });
      return;
    }

    res.json({
      invitedEmail: row.invited_email,
      householdName: row.household_name,
      inviterName: row.inviter_first
        ? `${row.inviter_first}${row.inviter_last ? ' ' + row.inviter_last : ''}`
        : (row.inviter_email ?? 'Someone'),
    });
  } catch (err) {
    console.error('[household/invite/token]', err);
    res.status(500).json({ error: 'Failed to look up invitation' });
  }
});

// POST /api/household/join/:token
router.post('/join/:token', requireAuth, async (req: AuthRequest, res) => {
  const { token } = req.params;
  try {
    const profile = await getProfile(req.uid!);
    if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }
    if (profile.household_id) { res.status(409).json({ error: 'Already in a household' }); return; }

    const r = await db.query(
      `SELECT id, household_id, invited_email, status, expires_at
       FROM household_invitation WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Invitation not found' }); return; }
    const invite = r.rows[0];
    if (invite.status !== 'pending') { res.status(410).json({ error: 'Invitation already used' }); return; }
    if (new Date(invite.expires_at) < new Date()) { res.status(410).json({ error: 'Invitation expired' }); return; }
    if (profile.email?.toLowerCase() !== invite.invited_email.toLowerCase()) {
      res.status(403).json({ error: 'This invitation was sent to a different email address' });
      return;
    }

    await db.query(
      `UPDATE user_profile SET household_id = $1 WHERE id = $2`,
      [invite.household_id, profile.id]
    );
    await db.query(
      `UPDATE household_invitation SET status = 'accepted' WHERE id = $1`,
      [invite.id]
    );

    res.json({ ok: true, householdId: invite.household_id });
  } catch (err) {
    console.error('[household/join]', err);
    res.status(500).json({ error: 'Failed to join household' });
  }
});

// DELETE /api/household/invitations/:invitationId
router.delete('/invitations/:invitationId', requireAuth, async (req: AuthRequest, res) => {
  const { invitationId } = req.params;
  try {
    const profile = await getProfile(req.uid!);
    if (!profile?.household_id) { res.status(403).json({ error: 'Not in a household' }); return; }
    if (!profile.is_household_admin) { res.status(403).json({ error: 'Admin only' }); return; }

    await db.query(
      `UPDATE household_invitation SET status = 'cancelled'
       WHERE id = $1 AND household_id = $2`,
      [invitationId, profile.household_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[household/invitations/cancel]', err);
    res.status(500).json({ error: 'Failed to cancel invitation' });
  }
});

function buildInviteEmail(inviterName: string, householdName: string, joinLink: string): string {
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
                You're invited.
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                ${inviterName} has invited you to join <strong style="color:#a33726;">${householdName}</strong> on Axis &amp; Bloom —
                a shared household where everyone gets coffee matched to their own palate,
                delivered together.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom:40px;">
              <a href="${joinLink}"
                 style="display:inline-block;padding:14px 32px;background:#a33726;color:#ffffff;
                        text-decoration:none;font-size:11px;letter-spacing:0.2em;
                        text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;">
                Join the Household
              </a>
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.<br/><br/>
                Having trouble with the button?
                <a href="${joinLink}" style="color:#a33726;">Copy this link</a>
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

export default router;
