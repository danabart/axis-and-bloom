// Unsubscribe sync, Part 7 (2026-10-01) — reconcile DB <-> Mailchimp consent.
// Shared by GET /api/cron/newsletter-reconcile and `npm run newsletter:reconcile`.
//
// Inward (the main job): every Mailchimp member that is unsubscribed or cleaned
// but still subscribed = true in the DB is flipped via unsubscribeByEmail(..,
// 'mailchimp') — catches anything that happened in Mailchimp before the webhook
// existed, or a webhook delivery that was lost.
// Outward (report, and push with apply): DB rows with subscribed = false that
// Mailchimp still holds as subscribed/pending (e.g. a mirror call that failed)
// are reported as mismatch_outward and, with apply, PATCHed to unsubscribed.
// Never flips anything in the subscribe direction.

import { db } from '../../db/client.js';
import { MC_ENABLED, listMailchimpMembersByStatus, getMailchimpMemberStatus, setMailchimpStatus } from './mailchimp.js';
import { unsubscribeByEmail } from './unsubscribe.js';

export interface ReconcileReport {
  dryRun: boolean;
  mailchimpEnabled: boolean;
  /** Mailchimp members with status unsubscribed or cleaned. */
  counted: number;
  /** ...of those, flipped to subscribed = false in the DB (or would be, on a dry run). */
  flipped: number;
  /** ...of those, already subscribed = false in the DB. */
  alreadyInSync: number;
  /** ...of those, no newsletter_subscriber row at all (left alone). */
  notInDb: number;
  /** DB-unsubscribed rows Mailchimp still holds as subscribed/pending. */
  mismatchOutward: number;
  /** ...of those, PATCHed to unsubscribed in Mailchimp (apply only). */
  pushedOutward: number;
  flippedEmails: string[];
  mismatchOutwardEmails: string[];
}

export async function reconcileNewsletter({ apply }: { apply: boolean }): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    dryRun: !apply, mailchimpEnabled: MC_ENABLED,
    counted: 0, flipped: 0, alreadyInSync: 0, notInDb: 0, mismatchOutward: 0, pushedOutward: 0,
    flippedEmails: [], mismatchOutwardEmails: [],
  };
  if (!MC_ENABLED) return report;

  // ── Inward ─────────────────────────────────────────────────────────────────
  const mcOut = [
    ...(await listMailchimpMembersByStatus('unsubscribed')),
    ...(await listMailchimpMembersByStatus('cleaned')),
  ].map(e => e.toLowerCase().trim());
  report.counted = mcOut.length;

  if (mcOut.length > 0) {
    const rows = await db.query<{ email: string; subscribed: boolean | null }>(
      `SELECT email, subscribed FROM newsletter_subscriber WHERE email = ANY($1::text[])`,
      [mcOut],
    );
    const dbState = new Map(rows.rows.map(r => [r.email, r.subscribed !== false]));
    for (const email of mcOut) {
      const subscribedInDb = dbState.get(email);
      if (subscribedInDb === undefined) { report.notInDb++; continue; }
      if (!subscribedInDb) { report.alreadyInSync++; continue; }
      if (apply) await unsubscribeByEmail(email, 'mailchimp');
      report.flipped++;
      report.flippedEmails.push(email);
    }
  }

  // ── Outward ────────────────────────────────────────────────────────────────
  const mcOutSet = new Set(mcOut);
  const dbUnsubscribed = await db.query<{ email: string }>(
    `SELECT email FROM newsletter_subscriber WHERE subscribed = false ORDER BY email`,
  );
  for (const { email } of dbUnsubscribed.rows) {
    if (mcOutSet.has(email)) continue;
    const status = await getMailchimpMemberStatus(email);
    if (status !== 'subscribed' && status !== 'pending') continue; // null = not in Mailchimp, or read failed
    report.mismatchOutward++;
    report.mismatchOutwardEmails.push(email);
    if (apply && await setMailchimpStatus(email, 'unsubscribed')) report.pushedOutward++;
  }

  return report;
}
