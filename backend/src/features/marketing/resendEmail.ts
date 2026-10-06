// Step 07 (C3): Resend transactional send — quiz-complete "Your archetype card is
// here" email, sent directly from the backend the moment a quiz signup lands
// (bypassing the Mailchimp marketing-send fingerprint that was pushing it to
// Promotions). Kept non-blocking and RESEND_ENABLED-guarded throughout, matching
// mailchimp.ts's contract exactly: a Resend failure must never fail the subscribe
// request. Plain fetch, no SDK — the `resend` npm package already used in
// routes/auth.ts (password reset) is a separate, pre-existing pattern; this module
// intentionally mirrors mailchimp.ts's zero-dependency style instead.

import { isSuppressed } from './unsubscribe.js';

const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? '').trim();
const RESEND_FROM = process.env.RESEND_FROM || 'Axis & Bloom <hello@axisandbloomcoffee.com>';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'hello@axisandbloomcoffee.com';

export const RESEND_ENABLED = Boolean(RESEND_API_KEY);

export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Unsubscribe sync (2026-10-01) — required so every caller declares it.
   * 'marketing': skipped for a suppressed address (newsletter_subscriber.subscribed
   * = false) and carries List-Unsubscribe headers. 'transactional': no check, no
   * headers — order, account, password-reset, household-invite, brew-card and
   * internal admin mail must keep reaching an unsubscribed customer. */
  kind: 'marketing' | 'transactional';
  /** Hosted one-click URL (buildUnsubscribeUrl) for the List-Unsubscribe header. */
  unsubscribeUrl?: string;
}

const UNSUBSCRIBE_MAILTO = 'mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe';

/** Pure: the RFC 2369 / RFC 8058 headers for a marketing send. Without a hosted
 * URL only the mailto target is offered, and no -Post header (one-click needs an
 * https target). */
export function buildListUnsubscribeHeaders(unsubscribeUrl?: string): Record<string, string> {
  if (!unsubscribeUrl) return { 'List-Unsubscribe': `<${UNSUBSCRIBE_MAILTO}>` };
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <${UNSUBSCRIBE_MAILTO}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export interface ResendSendResult {
  ok: boolean;
  /** Resend's own message id (from the response body), or null when
   * disabled, failed, or (belt-and-braces) the response didn't carry one.
   * Quiz Resync Fix Part B2 (2026-09-25) — previously discarded entirely;
   * now read and returned so callers can persist it for later lookup. */
  id: string | null;
  /** True when a marketing send was skipped because the address is unsubscribed
   * (ok stays true: nothing failed). A caller holding an at-most-once claim
   * should release it, so a later re-subscribe can still receive the email. */
  suppressed?: boolean;
}

/**
 * Send one email via the Resend API. Never throws — logs and returns
 * { ok: false, id: null } on failure, no-op returning { ok: true, id: null }
 * when disabled, and { ok: true, id: null, suppressed: true } for a marketing
 * send to an unsubscribed address. No open/click tracking options are passed (tracking is
 * intentionally unconfigured in Resend).
 */
export async function sendResendEmail({ to, subject, html, text, kind, unsubscribeUrl }: ResendEmailInput): Promise<ResendSendResult> {
  if (!RESEND_ENABLED) {
    console.debug('[resend] disabled — skipping send');
    return { ok: true, id: null };
  }
  try {
    if (kind === 'marketing' && await isSuppressed(to)) {
      console.log('[resend] suppressed — skipping marketing send');
      return { ok: true, id: null, suppressed: true };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        reply_to: RESEND_REPLY_TO,
        subject,
        html,
        text,
        ...(kind === 'marketing' ? { headers: buildListUnsubscribeHeaders(unsubscribeUrl) } : {}),
      }),
    });
    if (!res.ok) {
      console.error('[resend] error:', res.status, await res.text());
      return { ok: false, id: null };
    }
    let id: string | null = null;
    try {
      const body = (await res.json()) as { id?: string };
      id = body.id ?? null;
    } catch (err) {
      console.error('[resend] could not parse response body for id:', err);
    }
    return { ok: true, id };
  } catch (err) {
    console.error('[resend] sendResendEmail error:', err);
    return { ok: false, id: null };
  }
}
