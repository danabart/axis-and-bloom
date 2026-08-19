// Step 07 (C3): Resend transactional send — quiz-complete "Your archetype card is
// here" email, sent directly from the backend the moment a quiz signup lands
// (bypassing the Mailchimp marketing-send fingerprint that was pushing it to
// Promotions). Kept non-blocking and RESEND_ENABLED-guarded throughout, matching
// mailchimp.ts's contract exactly: a Resend failure must never fail the subscribe
// request. Plain fetch, no SDK — the `resend` npm package already used in
// routes/auth.ts (password reset) is a separate, pre-existing pattern; this module
// intentionally mirrors mailchimp.ts's zero-dependency style instead.

const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? '').trim();
const RESEND_FROM = process.env.RESEND_FROM || 'Axis & Bloom <hello@axisandbloomcoffee.com>';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'hello@axisandbloomcoffee.com';

export const RESEND_ENABLED = Boolean(RESEND_API_KEY);

export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one transactional email via the Resend API. Never throws — logs and
 * returns false on failure, no-op returning true when disabled. No open/click
 * tracking options are passed (tracking is intentionally unconfigured in Resend).
 */
export async function sendResendEmail({ to, subject, html, text }: ResendEmailInput): Promise<boolean> {
  if (!RESEND_ENABLED) {
    console.debug('[resend] disabled — skipping send');
    return true;
  }
  try {
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
      }),
    });
    if (!res.ok) {
      console.error('[resend] error:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[resend] sendResendEmail error:', err);
    return false;
  }
}
