// Roastery portal part 2, follow-up F3 (2026-10-05) — one plain internal email on
// every coffee submit: "<Roastery>: <coffee> submitted by <name>", with the admin
// page link. Recipients are the email addresses of all users whose type is `admin`,
// resolved at send time (roasteryPortalReads.listAdminEmails): no environment
// variable, no hardcoded address. Sent through the existing Resend helper and logged
// in transactional_email_log like the other transactional sends (one row per
// recipient and per submitted version, which also makes a repeat call a no-op).
//
// Never throws: a failed send must never fail the submit.

import { log } from '../lib/logger.js';
import { sendOnce } from './transactionalEmail.js';
import { listAdminEmails, getSubmissionContext } from './roasteryPortalReads.js';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SUBMIT_TEMPLATE_PREFIX = 'roastery-portal-submit:';

export async function notifySubmission(responseId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  try {
    const ctx = await getSubmissionContext(responseId);
    if (!ctx) return result;
    const recipients = await listAdminEmails();
    const who = ctx.submittedByName ?? 'a roaster';
    const subject = `${ctx.roasteryName}: ${ctx.coffeeName} submitted by ${who}`;
    const base = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '');
    const link = `${base}/admin/roastery-portal?roastery=${ctx.roasterId}&coffee=${ctx.portalCoffeeId}`;
    const text = `${subject} (version ${ctx.version}).\n\nOpen it in the admin page: ${link}\n`;
    const html = `<p>${escapeHtml(subject)} (version ${ctx.version}).</p><p><a href="${escapeHtml(link)}">Open it in the admin page</a></p>`;
    const template = `${SUBMIT_TEMPLATE_PREFIX}${responseId}`;

    for (const email of recipients) {
      // Claim first, release on failure: the shared door (services/transactionalEmail.ts,
      // Commerce 1). A second call for the same version and address sends nothing.
      const { status } = await sendOnce({ to: email, subject, html, text, kind: 'transactional', template });
      if (status === 'skipped') result.skipped++;
      else if (status === 'sent') result.sent++;
      else result.failed++;
    }
    log.info('[roastery-portal/notify]', subject, { responseId, ...result, recipients: recipients.length });
  } catch (err) {
    log.warn('[roastery-portal/notify]', err instanceof Error ? err.message : String(err), { responseId });
  }
  return result;
}
