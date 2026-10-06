import express, { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { syncMailchimpMember, toArchetypeSlug } from '../features/marketing/mailchimp.js';
import { sendResendEmail } from '../features/marketing/resendEmail.js';
import { renderQuizCompleteEmail } from '../features/marketing/templates/quizCompleteEmail.js';
import { normalizeCampaign, normalizeVid } from '../features/marketing/campaigns.js';
import {
  buildOneClickUnsubscribeUrl, buildUnsubscribeUrl, generateUnsubscribeToken, isSuppressed, unsubscribeByToken, unsubscribeTokenExists,
} from '../features/marketing/unsubscribe.js';
import { renderResponsePage } from '../lib/responsePage.js';

const router = Router();

// Step 07 (C3): quiz-complete email — sent at most once per (email, template), see
// transactional_email_log. Bump this key to re-enable one send of a future redesign.
const QUIZ_COMPLETE_TEMPLATE = 'quiz_complete_v2';

// Fire-and-forget the quiz-complete Resend send, guarded by an atomic DB claim so
// concurrent requests for the same email can't double-send. The claim is written
// immediately (sent_at = NOW()); a failed send rolls the claim back so the next
// quiz completion can retry — a Resend failure must never permanently block the
// email the way a real "already sent" would.
//
// Quiz Resync Fix Part B2 (2026-09-25) — `archetype` is now required and always
// the *verified* archetype (handleSubscribe below only calls this once the
// archetype has passed verifyArchetypeAgainstFunnel), never a client-supplied
// value taken on faith. The claim row is also updated with that archetype and
// Resend's own message id after a successful send, so a delivered email can be
// looked up/audited later without the Resend dashboard.
//
// Unsubscribe sync (2026-10-01) — this is a MARKETING send. Suppression is
// checked BEFORE the claim row is inserted: a claim left behind for a skipped
// send would mean a later re-subscribe never gets the email. sendResendEmail
// checks again (kind 'marketing'); if it reports suppressed (an unsubscribe
// landed in between), the claim is released the same way as a failed send.
export async function sendQuizCompleteEmailOnce(email: string, firstName: string, archetype: string) {
  if (await isSuppressed(email)) {
    console.log('[newsletter] suppressed — quiz-complete email not sent');
    return;
  }

  // handleSubscribe's upsert always leaves a token (minted on insert, COALESCEd
  // onto a pre-backfill row on conflict), so this is never null on the live path.
  // Read before the claim too, so a missing token never strands a claim row.
  const tokenResult = await db.query<{ unsubscribe_token: string | null }>(
    `SELECT unsubscribe_token FROM newsletter_subscriber WHERE email = $1`,
    [email],
  );
  const token = tokenResult.rows[0]?.unsubscribe_token;
  if (!token) {
    console.error('[newsletter] no unsubscribe_token — quiz-complete email not sent');
    return;
  }
  // Body link on the site domain; the List-Unsubscribe header goes straight to
  // Cloud Run, because mail servers can't pass Cloudflare's challenge (unsubscribe.ts).
  const unsubscribeUrl = buildUnsubscribeUrl(token);
  const oneClickUrl = buildOneClickUnsubscribeUrl(token);

  const claim = await db.query(
    `INSERT INTO transactional_email_log (email, template)
     VALUES ($1, $2)
     ON CONFLICT (email, template) DO NOTHING
     RETURNING email`,
    [email, QUIZ_COMPLETE_TEMPLATE],
  );
  if (claim.rowCount === 0) return; // already sent

  const archetypeSlug = toArchetypeSlug(archetype);
  const { subject, html, text } = renderQuizCompleteEmail(firstName || null, archetypeSlug, unsubscribeUrl);
  const { ok, id, suppressed } = await sendResendEmail({ to: email, subject, html, text, kind: 'marketing', unsubscribeUrl: oneClickUrl });
  if (!ok || suppressed) {
    await db.query(
      `DELETE FROM transactional_email_log WHERE email = $1 AND template = $2`,
      [email, QUIZ_COMPLETE_TEMPLATE],
    );
    return;
  }
  await db.query(
    `UPDATE transactional_email_log SET archetype = $1, resend_message_id = $2 WHERE email = $3 AND template = $4`,
    [archetype, id, email, QUIZ_COMPLETE_TEMPLATE],
  );
}

// Quiz Resync Fix Part B1 (2026-09-25) — a post_quiz archetype must be backed
// by a scored session in *this* window, not taken on faith from the client.
// quiz_final (Part A4) is checked alongside quiz_complete so a branched result
// verifies correctly too; slug comparison (toArchetypeSlug on both sides)
// makes the Balanced/"Balanced & Sweet" rename transparent to this check.
async function verifyArchetypeAgainstFunnel(quizSessionKey: string, archetype: string): Promise<boolean> {
  const result = await db.query<{ archetype: string | null }>(
    `SELECT archetype FROM quiz_funnel_event
     WHERE session_key = $1 AND event IN ('quiz_complete', 'quiz_final') AND archetype IS NOT NULL`,
    [quizSessionKey],
  );
  const candidateSlug = toArchetypeSlug(archetype);
  return result.rows.some(r => r.archetype && toArchetypeSlug(r.archetype) === candidateSlug);
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
  campaign?: string | null;
  campaignVid?: string | null;
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

  // Quiz Resync Fix Part B1 (2026-09-25) — a post_quiz archetype must be
  // backed by a scored session, or it is dropped (not written, not tagged,
  // no email) rather than trusted. Without this, any caller — including a
  // frontend bug firing the resync effect from stale/default state, which is
  // exactly what happened during the Hoboken Crawl — could silently
  // overwrite a subscriber's real archetype and Mailchimp tag with a value
  // no quiz ever produced. The subscribe itself still succeeds either way; a
  // rejected archetype is never a reason to fail someone's newsletter signup.
  let verifiedArchetype = extra.archetype ?? null;
  let verifiedExperimental = extra.experimental ?? null;
  let verifiedConfidence = extra.confidence ?? null;
  if (sourceName === 'post_quiz' && extra.archetype) {
    const backed = extra.quizSessionKey ? await verifyArchetypeAgainstFunnel(extra.quizSessionKey, extra.archetype) : false;
    if (!backed) {
      console.warn('[newsletter] archetype rejected — no scored session behind it', {
        emailHash: crypto.createHash('md5').update(clean).digest('hex'),
        quizSessionKey: extra.quizSessionKey ?? null,
        claimedArchetype: extra.archetype,
      });
      verifiedArchetype = null;
      verifiedExperimental = null;
      verifiedConfidence = null;
    }
  }

  // Hoboken Coffee Crawl (2026-08-31): campaign is a second, orthogonal dimension
  // from source — never write an unknown client-supplied campaign, and if campaign
  // doesn't normalize, drop vid too (no attribution timestamp without a real campaign).
  const cleanCampaign = normalizeCampaign(extra.campaign);
  const cleanCampaignVid = cleanCampaign ? normalizeVid(extra.campaignVid) : null;

  // Unsubscribe sync (2026-10-01): a token is minted on insert; on conflict an
  // existing token is never rotated (COALESCE keeps it), and a row from before
  // the backfill picks up the fresh one. A form submission is fresh consent, so
  // a re-subscribe also clears unsubscribed_at/unsubscribe_source.
  await db.query(
    `INSERT INTO newsletter_subscriber (email, first_name, source_id, user_id, archetype, experimental, confidence, quiz_session_key, campaign, campaign_vid, campaign_attributed_at, unsubscribe_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $9::text IS NOT NULL THEN now() END, $11)
     ON CONFLICT (email) DO UPDATE
       SET subscribed             = TRUE,
           unsubscribed_at        = NULL,
           unsubscribe_source     = NULL,
           unsubscribe_token      = COALESCE(newsletter_subscriber.unsubscribe_token, EXCLUDED.unsubscribe_token),
           first_name             = COALESCE(EXCLUDED.first_name, newsletter_subscriber.first_name),
           source_id              = COALESCE(newsletter_subscriber.source_id, EXCLUDED.source_id),
           user_id                = COALESCE(newsletter_subscriber.user_id, EXCLUDED.user_id),
           archetype              = COALESCE(EXCLUDED.archetype, newsletter_subscriber.archetype),
           experimental           = COALESCE(EXCLUDED.experimental, newsletter_subscriber.experimental),
           confidence             = COALESCE(EXCLUDED.confidence, newsletter_subscriber.confidence),
           quiz_session_key       = COALESCE(EXCLUDED.quiz_session_key, newsletter_subscriber.quiz_session_key),
           campaign               = COALESCE(newsletter_subscriber.campaign, EXCLUDED.campaign),
           campaign_vid           = COALESCE(newsletter_subscriber.campaign_vid, EXCLUDED.campaign_vid),
           campaign_attributed_at = COALESCE(newsletter_subscriber.campaign_attributed_at, CASE WHEN EXCLUDED.campaign IS NOT NULL THEN now() END)`,
    [clean, cleanName || null, sourceId, userId, verifiedArchetype, verifiedExperimental, verifiedConfidence, extra.quizSessionKey ?? null, cleanCampaign, cleanCampaignVid, generateUnsubscribeToken()],
  );

  // Forward to Mailchimp — non-blocking, never fails the request. The upsert
  // just set subscribed = TRUE, so its unconditional status 'subscribed' is
  // consent-backed here (the only live caller). Only the
  // verified archetype ever reaches the tag (Part B3 also makes this
  // replace-not-add on the Mailchimp side, see mailchimp.ts).
  syncMailchimpMember(clean, cleanName, { source: sourceName, archetype: verifiedArchetype, experimental: verifiedExperimental, campaign: cleanCampaign }).catch(err =>
    console.error('[newsletter] mailchimp error:', err)
  );

  // Step 07 (C3): quiz-complete email — transactional send from our own backend,
  // replacing the Mailchimp automation flow. Fire-and-forget, same as Mailchimp
  // above. Quiz Resync Fix Part B2 — only ever the verified archetype; a
  // rejected/absent archetype means no email fires at all (the quiz-complete
  // card without a real archetype behind it would just be wrong).
  if (sourceName === 'post_quiz' && verifiedArchetype) {
    sendQuizCompleteEmailOnce(clean, cleanName, verifiedArchetype).catch(err =>
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
  const { email, firstName = '', source = 'newsletter', archetype, experimental, confidence, quizSessionKey, campaign, campaignVid } = req.body as {
    email?: string; firstName?: string; source?: string;
    archetype?: string; experimental?: boolean; confidence?: string; quizSessionKey?: string;
    campaign?: string; campaignVid?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, { archetype, experimental, confidence, quizSessionKey, campaign, campaignVid, firebaseUid: req.uid }, res);
  } catch (err) {
    console.error('[newsletter/subscribe]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ── POST /api/newsletter ──────────────────────────────────────────────────────
// Backward-compat alias — NewsletterModal currently calls this path.
router.post('/', optionalAuth, async (req: AuthRequest, res) => {
  const { email, firstName = '', source = 'newsletter', archetype, experimental, confidence, quizSessionKey, campaign, campaignVid } = req.body as {
    email?: string; firstName?: string; source?: string;
    archetype?: string; experimental?: boolean; confidence?: string; quizSessionKey?: string;
    campaign?: string; campaignVid?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, { archetype, experimental, confidence, quizSessionKey, campaign, campaignVid, firebaseUid: req.uid }, res);
  } catch (err) {
    console.error('[newsletter]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ── Unsubscribe (2026-10-01, features/newsletter_unsubscribe/) ────────────────
// The hosted link in our marketing email and the List-Unsubscribe header both
// point at /api/newsletter/unsubscribe/:token (unsubscribe.ts buildUnsubscribeUrl).
// App-Check-exempt (middleware/appCheck.ts): opened from an inbox, the token in
// the path is the credential. Generous per-IP limit — it's a one-click link.
const unsubscribeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: getRealClientIp });

const NOT_VALID_PAGE = renderResponsePage('That link is no longer valid.');

// GET never writes. Corporate mail security (Outlook Safe Links, Mimecast,
// Proofpoint) opens every link in an email to scan it; an unsubscribe-on-GET
// would let a scanner unsubscribe a reader who never tapped anything. The token
// lookup only picks between the confirm page and a neutral 404, which never
// reveals whether an address exists.
router.get('/unsubscribe/:token', unsubscribeLimiter, async (req, res) => {
  const { token } = req.params;
  try {
    if (!(await unsubscribeTokenExists(token))) {
      res.status(404).send(NOT_VALID_PAGE);
      return;
    }
    res.send(renderResponsePage('One tap and we stop sending marketing emails to this address.', {
      heading: 'Unsubscribe from Axis &amp; Bloom emails?',
      actionHtml:
        `<form method="POST" action="/api/newsletter/unsubscribe/${token}" style="margin:0;">`
        + '<input type="hidden" name="confirm" value="1" />'
        + '<button type="submit" style="padding:14px 32px;background:#a33726;color:#ffffff;border:0;cursor:pointer;'
        + 'font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Unsubscribe</button>'
        + '</form>',
    }));
  } catch (err) {
    console.error('[newsletter/unsubscribe GET]', err);
    res.status(500).send(renderResponsePage('Something went wrong on our end — nothing was changed.'));
  }
});

// The only path that writes. Two callers: the confirm page's button (body
// empty or confirm=1) and mail clients' RFC 8058 one-click (body
// List-Unsubscribe=One-Click, sent only on a real user action). Told apart by
// that body field and nothing else. One-click gets 200 with an empty body (no
// redirect, no HTML, as RFC 8058 requires); the form gets the done page.
// urlencoded on this route only — the app parses JSON globally, nothing else.
router.post('/unsubscribe/:token', unsubscribeLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  const { token } = req.params;
  const oneClick = req.body?.['List-Unsubscribe'] === 'One-Click';
  try {
    const result = await unsubscribeByToken(token, oneClick ? 'one_click' : 'link');
    if (!result.ok) {
      if (oneClick) res.status(404).end();
      else res.status(404).send(NOT_VALID_PAGE);
      return;
    }
    if (oneClick) {
      res.status(200).end();
      return;
    }
    res.send(renderResponsePage(
      "We won't send marketing emails to this address. Your flavor profile and any orders stay exactly as they are.",
      {
        heading: "You're unsubscribed.",
        actionHtml: '<a href="https://axisandbloomcoffee.com" style="color:#a33726;font-size:13px;letter-spacing:0.1em;font-family:Arial,sans-serif;">Back to Axis &amp; Bloom</a>',
      },
    ));
  } catch (err) {
    console.error('[newsletter/unsubscribe POST]', err);
    if (oneClick) res.status(500).end();
    else res.status(500).send(renderResponsePage('Something went wrong on our end — nothing was changed.'));
  }
});

export default router;
