// Commerce 1, Dana's decision B (2026-10-31): the one door to
// transactional_email_log. Every backend email that must go at most once per
// (recipient, template) goes through sendOnce: the quiz-complete email
// (newsletter.sendQuizCompleteEmailOnce), the roastery portal submit notice
// (roasteryPortalNotify.notifySubmission) and the order emails
// (orderEmails.ts). Behaviour is the pattern those two callers already had,
// moved here unchanged:
//   1. claim: INSERT (email, template) ON CONFLICT DO NOTHING; no row back
//      means it was already sent, so nothing is sent;
//   2. send through sendResendEmail;
//   3. failed, thrown or suppressed: release the claim (DELETE), so a later
//      attempt may still send — a Resend failure must never block the email
//      the way a real "already sent" would;
//   4. sent: record resend_message_id (and archetype, for the quiz email).
// Never throws.
import { db } from '../db/client.js';
import { sendResendEmail, type ResendEmailInput } from '../features/marketing/resendEmail.js';

export interface SendOnceInput extends ResendEmailInput {
  /** transactional_email_log.template: the dedupe key with the recipient. */
  template: string;
  /** Written to transactional_email_log.archetype on a successful send (quiz email only). */
  archetype?: string | null;
}

export type SendOnceStatus = 'sent' | 'skipped' | 'failed' | 'suppressed';
export interface SendOnceResult { status: SendOnceStatus; id: string | null }

export async function sendOnce(input: SendOnceInput): Promise<SendOnceResult> {
  const { template, archetype, ...email } = input;
  try {
    const claim = await db.query(
      `INSERT INTO transactional_email_log (email, template) VALUES ($1, $2)
       ON CONFLICT (email, template) DO NOTHING RETURNING email`,
      [email.to, template],
    );
    if (claim.rowCount === 0) return { status: 'skipped', id: null };

    let sent: { ok: boolean; id: string | null; suppressed?: boolean };
    try { sent = await sendResendEmail(email); }
    catch { sent = { ok: false, id: null }; } // the helper never throws; belt and braces

    if (!sent.ok || sent.suppressed) {
      await db.query(`DELETE FROM transactional_email_log WHERE email = $1 AND template = $2`, [email.to, template])
        .catch(() => undefined);
      return { status: sent.suppressed ? 'suppressed' : 'failed', id: null };
    }
    if (sent.id || archetype) {
      await db.query(
        `UPDATE transactional_email_log SET resend_message_id = COALESCE($1, resend_message_id), archetype = COALESCE($2, archetype)
         WHERE email = $3 AND template = $4`,
        [sent.id, archetype ?? null, email.to, template],
      );
    }
    return { status: 'sent', id: sent.id };
  } catch (err) {
    console.error('[transactionalEmail] sendOnce failed', template, err instanceof Error ? err.message : err);
    return { status: 'failed', id: null };
  }
}
