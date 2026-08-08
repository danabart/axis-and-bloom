import { Router, type Request, type Response, type NextFunction } from 'express';
import { Resend } from 'resend';
import { db } from '../db/client.js';
import { processPendingMessages, parseInboundReply } from '../services/liamSmsFeedback.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { purgeStaleAnonymousGuests } from '../services/staleGuestCleanup.js';
import { getAliases } from '../services/sommelierRag.js';
import { generateBrewNoteSentence } from '../services/storyLayer.js';
import { getBagNumberForCoffee, getArrivalNoteConfig, getMostRecentCard, type BrewCardParams } from '../services/brewCard.js';
import { buildDialInSmsBody, respondToDialInBeat } from '../services/beatEngine.js';
import { backfillCoffeeContent } from './coffees.js';

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

// ── GET /api/cron/brew-card-arrival-send ─────────────────────────────────────
// HOME_TASK_6 (§3.1) — same daily-cron shape as liam-sms-send above: finds
// user_brew_card rows created by an order (origin='arrival_note') whose
// scheduled delay has passed and no email has gone out yet, renders the note,
// sends it, and marks it sent. Cloud Scheduler job: daily → GET this path
// with the same x-cron-secret header as liam-sms-send.
router.get('/brew-card-arrival-send', requireCronSecret, async (_req, res) => {
  try {
    const result = await processArrivalNotes();
    res.json(result);
  } catch (err) {
    console.error('[cron/brew-card-arrival-send]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

// ── GET /api/cron/beat-dial-in-send ──────────────────────────────────────────
// HOME_TASK_8 (§3.1) — same daily-cron shape as the two jobs above: finds
// due dial_in beat_event rows (scheduled_at passed, not yet sent), delivers
// each on its recorded channel, marks sent_at. Cloud Scheduler job: daily →
// GET this path with the same x-cron-secret header.
router.get('/beat-dial-in-send', requireCronSecret, async (_req, res) => {
  try {
    const result = await processDueDialInBeats();
    res.json(result);
  } catch (err) {
    console.error('[cron/beat-dial-in-send]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

// ── GET /api/cron/coffee-content-backfill ────────────────────────────────────
// C3 (M2 fix) — same daily-cron shape as the jobs above. The only authenticated,
// non-public trigger for AI content generation now that GET /api/coffees/:id/
// content and /:id/ai-summary are pure reads (coffees.ts); the other trigger is
// an admin's explicit POST /api/admin/coffees/:id/refresh-content (requireAdmin).
// backfillCoffeeContent() (coffees.ts) already goes through the C2 global
// spend gate on every Claude call it makes (via generateAndStoreAllContent ->
// getCoffeeSummary/-SurpriseNote/-ThreeVoiceStory/generateCoffeeStoryWithRetry,
// all guardClaudeCall-wrapped) and stops early the moment a call is blocked.
// Cloud Scheduler job: daily → GET this path with the same x-cron-secret header.
router.get('/coffee-content-backfill', requireCronSecret, async (_req, res) => {
  try {
    const result = await backfillCoffeeContent();
    res.json(result);
  } catch (err) {
    console.error('[cron/coffee-content-backfill]', err);
    res.status(500).json({ error: 'Cron job failed' });
  }
});

export async function processDueDialInBeats(): Promise<{ processed: number; sent: number; failed: number }> {
  const due = await db.query<{
    id: number; user_id: string; coffee_id: number; channel: 'sms' | 'email'; respond_token: string;
    first_name: string | null; email_address: string | null; phone_number: string | null;
  }>(
    `SELECT be.id, be.user_id, be.coffee_id, be.channel, be.respond_token,
            up.first_name, ue.email_address, ph.phone_number
     FROM beat_event be
     JOIN user_profile up ON up.id = be.user_id
     LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
     LEFT JOIN user_phone ph ON ph.user_id = up.id AND ph.sms_beats_opt_in = true
     WHERE be.beat_type = 'dial_in'
       AND be.sent_at IS NULL
       AND be.scheduled_at IS NOT NULL
       AND be.scheduled_at <= NOW()
     ORDER BY be.scheduled_at ASC
     LIMIT 50`
  );

  let sent = 0;
  let failed = 0;

  for (const row of due.rows) {
    try {
      const aliasMap = await getAliases([row.coffee_id]);
      const alias = aliasMap.get(row.coffee_id) ?? 'your coffee';
      const card = await getMostRecentCard(row.user_id, row.coffee_id);
      const method = card?.method ?? 'other';
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

      if (row.channel === 'sms') {
        // Reuses sommelier_sms_feedback + the existing processPendingMessages()
        // cron for the actual send — not a second scheduling mechanism.
        // message_kind/beat_event_id let the inbound webhook tell this apart
        // from a legacy post-delivery reply without touching
        // parseInboundReply()'s own signature.
        const { primary } = buildDialInSmsBody(alias, method);
        if (row.phone_number) {
          await db.query(
            `INSERT INTO sommelier_sms_feedback
               (user_id, blend_id, phone_number, direction, body, status, scheduled_for, message_kind, beat_event_id)
             VALUES ($1, NULL, $2, 'outbound', $3, 'scheduled', NOW(), 'beat_dial_in', $4)`,
            [row.user_id, row.phone_number, primary, row.id]
          );
        } else {
          console.warn('[cron/beat-dial-in-send] channel=sms but no consented phone on file for user', row.user_id, '— skipping send, not falling back to email silently');
        }
      } else if (row.email_address) {
        // H3/C4 — the token, never the SERIAL id, is what goes in the link.
        const respondBase = `${backendUrl}/api/beats/dial-in/${row.respond_token}/respond`;
        // Resend's send() resolves { data, error } — it does not throw for an
        // API-level failure (invalid recipient, provider outage, etc.), only
        // for a network-level one. Checking .error is required, not optional
        // — the pre-existing pattern here fell straight through to marking
        // sent_at regardless (HOME_TASK_9/OT-16 fix, applied consistently
        // across all four cron send sites in this file).
        const { error: sendError } = await resend.emails.send({
          from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
          to: row.email_address,
          subject: `How's the first cup of ${alias}?`,
          html: buildDialInEmail({
            firstName: row.first_name,
            alias,
            respondBase,
            talkLink: `${frontendUrl}/sommelier?entry=bag&coffee=${row.coffee_id}`,
          }),
        });
        if (sendError) {
          console.error('[cron/beat-dial-in-send] Resend error for beat', row.id, sendError);
          failed++;
          continue;
        }
      } else {
        console.warn('[cron/beat-dial-in-send] no email on file for user', row.user_id, '— marking sent without delivery');
      }

      await db.query(`UPDATE beat_event SET sent_at = NOW() WHERE id = $1`, [row.id]);
      sent++;
    } catch (err) {
      console.error('[cron/beat-dial-in-send] failed for beat', row.id, err);
      failed++;
    }
  }

  return { processed: due.rows.length, sent, failed };
}

function buildDialInEmail(params: { firstName: string | null; alias: string; respondBase: string; talkLink: string }): string {
  const greeting = params.firstName ? `Hi ${params.firstName},` : 'Hi there,';
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
                How's the first cup of ${params.alias}?
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                ${greeting} lighter or bolder than you expected? One tap tells Liam, and he'll adjust your brew card for next time.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:40px;">
              <a href="${params.respondBase}?expectation=lighter" style="display:inline-block;margin:0 8px 8px 0;padding:12px 24px;background:#f2f1ea;color:#a33726;text-decoration:none;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;border:1px solid #a33726;">Lighter</a>
              <a href="${params.respondBase}?expectation=as_expected" style="display:inline-block;margin:0 8px 8px 0;padding:12px 24px;background:#f2f1ea;color:#a33726;text-decoration:none;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;border:1px solid #a33726;">About right</a>
              <a href="${params.respondBase}?expectation=bolder" style="display:inline-block;margin:0 8px 8px 0;padding:12px 24px;background:#f2f1ea;color:#a33726;text-decoration:none;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;border:1px solid #a33726;">Bolder</a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                Prefer to talk it through? <a href="${params.talkLink}" style="color:#a33726;">Talk to Liam about this bag</a>.
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

const ARRIVAL_METHOD_LABEL: Record<string, string> = {
  v60: 'V60', french_press: 'French press', espresso: 'Espresso', moka: 'Moka pot',
  aeropress: 'Aeropress', cold_brew: 'Cold brew', drip: 'Drip', other: 'your usual method',
};

export async function processArrivalNotes(): Promise<{ processed: number; sent: number; failed: number }> {
  const due = await db.query<{
    id: number; user_id: string; coffee_id: number; method: string; params: BrewCardParams;
    first_name: string | null; email_address: string | null;
  }>(
    `SELECT bc.id, bc.user_id, bc.coffee_id, bc.method, bc.params,
            up.first_name, ue.email_address
     FROM user_brew_card bc
     JOIN user_profile up ON up.id = bc.user_id
     LEFT JOIN user_email ue ON ue.user_id = up.id AND ue.is_primary = true
     WHERE bc.origin = 'arrival_note'
       AND bc.arrival_email_sent_at IS NULL
       AND bc.arrival_email_scheduled_for <= NOW()
     ORDER BY bc.arrival_email_scheduled_for ASC
     LIMIT 50`
  );

  let sent = 0;
  let failed = 0;

  for (const row of due.rows) {
    try {
      // Roaster-blind, alias-only — same S44/S77 discipline as every other
      // customer-facing render path. Never the raw coffees.name/roaster.
      const aliasMap = await getAliases([row.coffee_id]);
      const alias = aliasMap.get(row.coffee_id) ?? 'Your coffee';

      const bagNumber = await getBagNumberForCoffee(row.user_id, row.coffee_id);
      const { shortNoteFromBagNumber } = getArrivalNoteConfig();
      const isFirstBag = bagNumber < shortNoteFromBagNumber;

      let warmSentence: string | null = null;
      if (isFirstBag) {
        const [archResult, rawResult, descriptorResult] = await Promise.all([
          db.query(
            `SELECT aa.archetype::text AS archetype FROM archetype_assignments aa
             WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL LIMIT 1`,
            [row.coffee_id]
          ),
          db.query(`SELECT name, roaster FROM coffees WHERE id = $1`, [row.coffee_id]),
          db.query(
            `SELECT descriptor FROM v_collaborative_flavor_wheel WHERE coffee_id = $1
             GROUP BY descriptor ORDER BY COUNT(*) DESC LIMIT 4`,
            [row.coffee_id]
          ),
        ]);
        // First-ever bag gets the fullest note (§3.1) — the one-sentence
        // content-pipeline hook; later bags skip it (isFirstBag false), same
        // "shorter note" rule the length itself already implements below.
        warmSentence = await generateBrewNoteSentence(
          { displayName: alias, archetype: archResult.rows[0]?.archetype ?? null, topDescriptors: descriptorResult.rows.map((r: { descriptor: string }) => r.descriptor) },
          { rawCoffeeName: rawResult.rows[0]?.name ?? null, roasterNames: rawResult.rows[0]?.roaster ? [rawResult.rows[0].roaster] : [] }
        );
      }

      if (row.email_address) {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        // Resend's send() resolves { data, error } rather than throwing on an
        // API-level failure — checking .error before marking sent is required
        // (HOME_TASK_9/OT-16 fix: "check the Resend response before marking
        // arrival_email_sent_at; on failure, leave the row schedulable and
        // log it"). A failed send now leaves arrival_email_sent_at NULL so
        // the next cron run retries it, instead of silently losing the note.
        const { error: sendError } = await resend.emails.send({
          from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
          to: row.email_address,
          subject: `${alias} has arrived`,
          html: buildArrivalNoteEmail({
            firstName: row.first_name,
            alias,
            method: row.method,
            params: row.params,
            warmSentence,
            coffeeId: row.coffee_id,
            talkLink: `${frontendUrl}/sommelier?entry=bag&coffee=${row.coffee_id}`,
          }),
        });
        if (sendError) {
          console.error('[cron/brew-card-arrival-send] Resend error for card', row.id, sendError);
          failed++;
          continue;
        }
      } else {
        // No email on file — can't send, and there's no other channel wired
        // yet (Task 8's SMS beat is a separate, later trigger). Mark sent
        // anyway so this row doesn't retry forever; logged so it's visible.
        console.warn('[cron/brew-card-arrival-send] no email on file for user', row.user_id, '— marking sent without delivery');
      }

      await db.query(`UPDATE user_brew_card SET arrival_email_sent_at = NOW() WHERE id = $1`, [row.id]);
      sent++;
    } catch (err) {
      console.error('[cron/brew-card-arrival-send] failed for card', row.id, err);
      failed++;
    }
  }

  return { processed: due.rows.length, sent, failed };
}

// Exported for direct unit verification (same reasoning cron.ts's own
// buildSponsoredLapsedEmail/buildSponsoredTrialEndingEmail didn't need this
// for, but a placeholder RESEND_API_KEY in this environment makes a real
// send unverifiable end-to-end — see HOME_TASK_6's build log).
export function buildArrivalNoteEmail(params: {
  firstName: string | null;
  alias: string;
  method: string;
  params: BrewCardParams;
  warmSentence: string | null;
  coffeeId: number;
  talkLink: string;
}): string {
  const greeting = params.firstName ? `Hi ${params.firstName},` : 'Hi there,';
  const methodLabel = ARRIVAL_METHOD_LABEL[params.method] ?? params.method;
  const tempLine = params.params.tempC != null ? `, ${params.params.tempC}°C` : '';
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
                ${params.alias} has arrived.
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0 0 16px;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">
                ${greeting}
              </p>
              ${params.warmSentence ? `<p style="margin:0 0 16px;font-size:16px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">${params.warmSentence}</p>` : ''}
              <p style="margin:0 0 8px;font-size:14px;color:#a33726;line-height:1.6;font-family:Arial,sans-serif;font-weight:500;">
                Your ${methodLabel}: ${params.params.ratio}, ${params.params.grindLabel}${tempLine}.
              </p>
              ${params.params.notes ? `<p style="margin:0;font-size:14px;color:#6b5a56;line-height:1.6;font-family:Arial,sans-serif;font-weight:300;">${params.params.notes}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:40px;">
              <a href="${params.talkLink}"
                 style="display:inline-block;padding:14px 32px;background:#a33726;color:#ffffff;
                        text-decoration:none;font-size:11px;letter-spacing:0.2em;
                        text-transform:uppercase;font-family:Arial,sans-serif;font-weight:500;">
                Talk to Liam About This Bag
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e8e4dc;padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#a33726;opacity:0.5;font-family:Arial,sans-serif;line-height:1.6;">
                This card lives on your Profile's Flavor Memory page — it updates as you and Liam adjust it together.
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
            // See the arrival-note/dial-in cron sends above (HOME_TASK_9/OT-16
            // fix) — Resend resolves { data, error } rather than throwing on
            // an API-level failure, so .error must be checked explicitly.
            const { error: sendError } = await resend.emails.send({
              from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
              to: row.email_address,
              subject: 'Your sponsored Axis & Bloom subscription has ended',
              html: buildSponsoredLapsedEmail(row.first_name, `${frontendUrl}/profile`),
            });
            if (sendError) console.error('[cron/sponsored-subscription-check] lapsed email Resend error:', sendError);
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
            const { error: sendError } = await resend.emails.send({
              from: 'Axis & Bloom <noreply@axisandbloomcoffee.com>',
              to: row.email_address,
              subject: 'Your sponsored Axis & Bloom subscription is ending soon',
              html: buildSponsoredTrialEndingEmail(row.first_name, `${frontendUrl}/profile`),
            });
            if (sendError) console.error('[cron/sponsored-subscription-check] trial-ending email Resend error:', sendError);
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
      message_kind: string;
      beat_event_id: number | null;
    }>(
      `SELECT id, user_id, order_id, blend_id, message_kind, beat_event_id
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

    // Parse async — don't await, per S18's "webhook always returns 200" discipline.
    // HOME_TASK_8 — a beat_dial_in-originated reply additionally adjusts the
    // brew card via the same respondToDialInBeat() the on-site card door
    // uses (routes/beats.ts) — parseInboundReply() itself knows nothing about
    // beats, only returns the parsed expectation it already computed.
    (async () => {
      try {
        const { expectation } = await parseInboundReply(body, outboundRow, inboundResult.rows[0].id);
        if (outboundRow.message_kind === 'beat_dial_in' && outboundRow.beat_event_id && expectation) {
          await respondToDialInBeat(outboundRow.beat_event_id, expectation, 'sms_feedback');
        }
      } catch (err) {
        console.error('[liamSms] parseInboundReply failed:', err);
      }
    })();
  } catch (err) {
    console.error('[webhooks/sms/inbound]', err);
  }

  // Always return 200 — provider will retry on non-200
  res.status(200).send('');
});

export default router;
