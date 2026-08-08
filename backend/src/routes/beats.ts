import { Router } from 'express';
import { respondToDialInBeat, resolveDialInBeatIdByRespondToken } from '../services/beatEngine.js';

const router = Router();

// ── GET /api/beats/dial-in/:token/respond ─────────────────────────────────────
// HOME_TASK_8 (§3.1, spec item 2) — "on-site via the card's door." A capability
// link (the token itself, emailed only to its own recipient) rather than a
// logged-in form — the same low-friction, single-click pattern the email's
// own quick-response buttons need to work without asking the customer to sign
// in again from their inbox. GET is used deliberately for the same reason a
// calendar RSVP or unsubscribe link uses GET: one click, no form, no session
// requirement — respondToDialInBeat() is itself idempotent (a beat_event that
// already has responded_at is a no-op), so a prefetching email client or a
// double-click can't double-adjust the card.
//
// H3/C4 security fix — this used to identify the beat by beat_event.id, a
// plain SERIAL: unauthenticated, no ownership check, trivially enumerable
// (loop integers, mark any customer's beat responded, shift *their* next
// brew-card grind). The SERIAL id never appears in this URL anymore — the
// path segment is now an unguessable 32-byte token (respond_token,
// schema.sql), looked up directly with no separate existence-then-ownership
// step to time or otherwise distinguish. A wrong/guessed/expired-format
// token and a real-but-already-responded beat both resolve through the same
// 404/idempotent-no-op shape below where relevant — nothing here tells an
// attacker "closer" from "not even close."
router.get('/dial-in/:token/respond', async (req, res) => {
  const { token } = req.params;
  const expectation = req.query.expectation as string | undefined;

  if (!token || !['lighter', 'as_expected', 'bolder'].includes(expectation ?? '')) {
    res.status(400).send(renderResponsePage('That link looks incomplete — nothing was recorded.'));
    return;
  }

  try {
    const beatEventId = await resolveDialInBeatIdByRespondToken(token);
    if (beatEventId === null) {
      res.status(404).send(renderResponsePage('That link is no longer valid — nothing was recorded.'));
      return;
    }
    const applied = await respondToDialInBeat(beatEventId, expectation as 'lighter' | 'as_expected' | 'bolder', 'onsite_feedback');
    res.send(renderResponsePage(
      applied
        ? "Got it — thanks. Liam's adjusted your brew card for next time."
        : "Looks like you've already answered this one — nothing more to do here."
    ));
  } catch (err) {
    console.error('[beats/dial-in/respond]', err);
    res.status(500).send(renderResponsePage('Something went wrong on our end — no changes were made.'));
  }
});

function renderResponsePage(message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Axis &amp; Bloom</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ea;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ea;min-height:100vh;">
    <tr>
      <td align="center" style="padding:80px 24px;">
        <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#a33726;">Axis &amp; Bloom</p>
        <p style="margin:0;font-size:20px;color:#6b5a56;line-height:1.6;max-width:420px;">${message}</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export default router;
