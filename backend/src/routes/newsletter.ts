import { Router } from 'express';
import { db } from '../db/client.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { syncMailchimpMember, toArchetypeSlug } from '../features/marketing/mailchimp.js';
import { sendResendEmail } from '../features/marketing/resendEmail.js';
import { renderQuizCompleteEmail } from '../features/marketing/templates/quizCompleteEmail.js';

const router = Router();

// Step 07 (C3): quiz-complete email — sent at most once per (email, template), see
// transactional_email_log. Bump this key to re-enable one send of a future redesign.
const QUIZ_COMPLETE_TEMPLATE = 'quiz_complete_v2';

// Fire-and-forget the quiz-complete Resend send, guarded by an atomic DB claim so
// concurrent requests for the same email can't double-send. The claim is written
// immediately (sent_at = NOW()); a failed send rolls the claim back so the next
// quiz completion can retry — a Resend failure must never permanently block the
// email the way a real "already sent" would.
async function sendQuizCompleteEmailOnce(email: string, firstName: string, archetype: string | undefined) {
  const claim = await db.query(
    `INSERT INTO transactional_email_log (email, template)
     VALUES ($1, $2)
     ON CONFLICT (email, template) DO NOTHING
     RETURNING email`,
    [email, QUIZ_COMPLETE_TEMPLATE],
  );
  if (claim.rowCount === 0) return; // already sent

  const archetypeSlug = archetype ? toArchetypeSlug(archetype) : null;
  const { subject, html, text } = renderQuizCompleteEmail(firstName || null, archetypeSlug);
  const sent = await sendResendEmail({ to: email, subject, html, text });
  if (!sent) {
    await db.query(
      `DELETE FROM transactional_email_log WHERE email = $1 AND template = $2`,
      [email, QUIZ_COMPLETE_TEMPLATE],
    );
  }
}

// ── Shared subscribe logic ────────────────────────────────────────────────────
// Step 04 (A2): extended to carry the quiz result along with the signup (archetype/
// experimental/confidence/quizSessionKey — all nullable, only populated when the
// signup originated from a quiz completion) and to link user_id when the caller is
// signed in, via optionalAuth. archetype/experimental/confidence/quizSessionKey use
// COALESCE(new, existing) so a later non-quiz signup (no archetype in the payload)
// never wipes a previously-captured quiz result — but a quiz retake's new archetype
// does overwrite the old one, since a value IS provided in that case.
interface SubscribeExtras {
  archetype?: string;
  experimental?: boolean;
  confidence?: string;
  quizSessionKey?: string;
  firebaseUid?: string;
}

async function handleSubscribe(
  email: string,
  sourceName: string,
  firstName: string,
  extra: SubscribeExtras,
  res: Parameters<Parameters<typeof router.post>[1]>[1],
) {
  const clean     = email.toLowerCase().trim();
  const cleanName = typeof firstName === 'string' ? firstName.trim() : '';

  const srcResult = await db.query(
    `SELECT id FROM subscriber_source WHERE name = $1`,
    [sourceName],
  );
  const sourceId: number | null = srcResult.rows[0]?.id ?? null;

  let userId: string | null = null;
  if (extra.firebaseUid) {
    const profileResult = await db.query(
      `SELECT id FROM user_profile WHERE firebase_uid = $1`,
      [extra.firebaseUid],
    );
    userId = profileResult.rows[0]?.id ?? null;
  }

  await db.query(
    `INSERT INTO newsletter_subscriber (email, first_name, source_id, user_id, archetype, experimental, confidence, quiz_session_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO UPDATE
       SET subscribed       = TRUE,
           first_name       = COALESCE(EXCLUDED.first_name, newsletter_subscriber.first_name),
           source_id        = COALESCE(newsletter_subscriber.source_id, EXCLUDED.source_id),
           user_id          = COALESCE(newsletter_subscriber.user_id, EXCLUDED.user_id),
           archetype        = COALESCE(EXCLUDED.archetype, newsletter_subscriber.archetype),
           experimental     = COALESCE(EXCLUDED.experimental, newsletter_subscriber.experimental),
           confidence       = COALESCE(EXCLUDED.confidence, newsletter_subscriber.confidence),
           quiz_session_key = COALESCE(EXCLUDED.quiz_session_key, newsletter_subscriber.quiz_session_key)`,
    [clean, cleanName || null, sourceId, userId, extra.archetype ?? null, extra.experimental ?? null, extra.confidence ?? null, extra.quizSessionKey ?? null],
  );

  // Forward to Mailchimp — non-blocking, never fails the request
  syncMailchimpMember(clean, cleanName, { source: sourceName, archetype: extra.archetype, experimental: extra.experimental }).catch(err =>
    console.error('[newsletter] mailchimp error:', err)
  );

  // Step 07 (C3): quiz-complete email — transactional send from our own backend,
  // replacing the Mailchimp automation flow. Fire-and-forget, same as Mailchimp above.
  if (sourceName === 'post_quiz') {
    sendQuizCompleteEmailOnce(clean, cleanName, extra.archetype).catch(err =>
      console.error('[newsletter] resend error:', err)
    );
  }

  res.json({ ok: true });
}

// ── POST /api/newsletter/subscribe ───────────────────────────────────────────
// Body: { email, firstName?, source?, archetype?, experimental?, confidence?, quizSessionKey? }
// optionalAuth: public (guests must be able to subscribe), but links user_id when
// the caller is signed in.
router.post('/subscribe', optionalAuth, async (req: AuthRequest, res) => {
  const { email, firstName = '', source = 'newsletter', archetype, experimental, confidence, quizSessionKey } = req.body as {
    email?: string; firstName?: string; source?: string;
    archetype?: string; experimental?: boolean; confidence?: string; quizSessionKey?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, { archetype, experimental, confidence, quizSessionKey, firebaseUid: req.uid }, res);
  } catch (err) {
    console.error('[newsletter/subscribe]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ── POST /api/newsletter ──────────────────────────────────────────────────────
// Backward-compat alias — NewsletterModal currently calls this path.
router.post('/', optionalAuth, async (req: AuthRequest, res) => {
  const { email, firstName = '', source = 'newsletter', archetype, experimental, confidence, quizSessionKey } = req.body as {
    email?: string; firstName?: string; source?: string;
    archetype?: string; experimental?: boolean; confidence?: string; quizSessionKey?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, { archetype, experimental, confidence, quizSessionKey, firebaseUid: req.uid }, res);
  } catch (err) {
    console.error('[newsletter]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

export default router;
