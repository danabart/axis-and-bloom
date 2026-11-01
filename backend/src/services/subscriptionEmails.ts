// Commerce 2 (2026-10-31) — the subscription emails, through the one
// transactional_email_log door (transactionalEmail.sendOnce), deduped on
// recipient + template:
//   subscription_upcoming:<subscriptionId>:<cycleDate>          the coffee lined up, N days before (B4 step 2)
//   subscription_payment_trouble:<invoiceId>:<attempt>          a renewal charge failed (B4/B5), with the update-card link (Commerce 3)
//   subscription_<change>:<eventId>                             the customer's own change confirmed (Commerce 3: frequency, skip, pause, resume, cancel, card)
//   admin_subscription_attention:<subscriptionId>:<cycleDate>   a renewal could not be prepared (an item we cannot name, no address)
// Customer emails use the order confirmation's card and voice (house names
// only, no urgency); the admin email is internal and plain.
import admin from './firebase-admin.js';
import { db } from '../db/client.js';
import { commerceParamText } from './commerceParameters.js';
import { sendOnce, type SendOnceResult } from './transactionalEmail.js';
import type { ShipmentLine } from './subscriptionShipment.js';

const IMAGE_BASE = 'https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card';
const FRONTEND_URL = () => (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const FONT = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "Tuesday, November 18" for a YYYY-MM-DD calendar date. */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

interface Recipient { email: string; firstName: string | null }

async function recipientFor(subscriptionId: string): Promise<Recipient | null> {
  const row = (await db.query<{ firebase_uid: string; first_name: string | null }>(
    `SELECT up.firebase_uid, up.first_name FROM subscription s JOIN user_profile up ON up.id = s.user_id WHERE s.id = $1`, [subscriptionId]
  )).rows[0];
  if (!row) return null;
  try {
    const email = (await admin.auth().getUser(row.firebase_uid)).email ?? null;
    return email ? { email, firstName: row.first_name } : null;
  } catch (err) {
    console.warn('[subscriptionEmails] no Firebase email for subscription', subscriptionId, err instanceof Error ? err.message : err);
    return null;
  }
}

function card(title: string, headline: string, bodyRows: string[], link: { href: string; label: string }): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff">
    <tr><td align="center" style="padding:34px 12px 48px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#f2f1ea" style="width:600px;max-width:600px;background-color:#f2f1ea;border:1px solid #c5c7c8;">
        <tr><td align="center" style="padding:46px 40px 0;"><img src="${IMAGE_BASE}/logo-quarter.png" width="26" alt="" style="display:block;border:0;width:26px;height:auto;" /></td></tr>
        <tr><td align="center" style="padding:14px 40px 0;${FONT};font-size:12px;letter-spacing:5px;color:#9a2918;font-weight:bold;">AXIS&nbsp;&amp;&nbsp;BLOOM</td></tr>
        <tr><td align="center" style="padding:38px 40px 0;${FONT};font-size:27px;line-height:38px;color:#9a2918;">${headline}</td></tr>
        ${bodyRows.map(r => `<tr><td style="padding:22px 40px 0;${FONT};font-size:15px;line-height:24px;color:#3b2f2a;">${r}</td></tr>`).join('\n        ')}
        <tr><td style="padding:22px 40px 46px;${FONT};font-size:14px;line-height:22px;"><a href="${esc(link.href)}" style="color:#9a2918;text-decoration:underline;">${esc(link.label)}</a></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const lineText = (l: Pick<ShipmentLine, 'quantity' | 'displayName' | 'weightOz'>) => `${l.quantity} × ${l.displayName}${l.weightOz ? ` · ${l.weightOz} oz` : ''}`;

// ── upcoming delivery ────────────────────────────────────────────────────────

export function renderSubscriptionUpcomingEmail(input: {
  firstName: string | null; cycleDate: string; lines: Array<Pick<ShipmentLine, 'quantity' | 'displayName' | 'weightOz'>>; hasDialItem: boolean;
}): { subject: string; html: string; text: string } {
  const when = longDate(input.cycleDate);
  const headline = input.firstName ? `${esc(input.firstName)}, your next coffee is lined up.` : 'Your next coffee is lined up.';
  const dialUrl = `${FRONTEND_URL()}/bloom`;
  const intro = `On ${when} we'll roast and send:`;
  const dialNote = input.hasDialItem ? 'Want something different? Turn your Bloom Dial before then and the next bag follows it.' : null;
  const html = card('Your next coffee', headline, [
    esc(intro),
    input.lines.map(l => esc(lineText(l))).join('<br />'),
    ...(dialNote ? [esc(dialNote)] : []),
  ], { href: input.hasDialItem ? dialUrl : `${FRONTEND_URL()}/profile?tab=orders`, label: input.hasDialItem ? 'Open your Bloom Dial' : 'See your subscription' });
  const text = [
    input.firstName ? `${input.firstName}, your next coffee is lined up.` : 'Your next coffee is lined up.',
    '', intro, ...input.lines.map(lineText), '',
    ...(dialNote ? [dialNote, `Your Bloom Dial: ${dialUrl}`] : [`Your subscription: ${FRONTEND_URL()}/profile?tab=orders`]),
  ].join('\n');
  return { subject: `Your next coffee ships ${when}`, html, text };
}

export async function sendSubscriptionUpcomingEmail(subscriptionId: string, cycleDate: string, lines: ShipmentLine[]): Promise<SendOnceResult> {
  const to = await recipientFor(subscriptionId);
  if (!to) throw new Error(`subscription ${subscriptionId}: the customer has no email address`);
  return sendOnce({
    to: to.email, kind: 'transactional', template: `subscription_upcoming:${subscriptionId}:${cycleDate}`,
    ...renderSubscriptionUpcomingEmail({ firstName: to.firstName, cycleDate, lines, hasDialItem: lines.some(l => l.archetype) }),
  });
}

// ── payment trouble ──────────────────────────────────────────────────────────

export function renderPaymentTroubleEmail(input: { firstName: string | null; amountCents: number | null }): { subject: string; html: string; text: string } {
  const headline = input.firstName ? `${esc(input.firstName)}, your card didn't go through.` : "Your card didn't go through.";
  const body1 = `We tried to charge your card for your next delivery${input.amountCents ? ` (${money(input.amountCents)})` : ''} and the bank said no.`;
  // Commerce 3 (OT-62): the link opens the card update on Profile; a saved card retries the delivery at once.
  const body2 = "We'll try again over the next few days. If your card has changed, update it and we'll retry right away.";
  const updateUrl = `${FRONTEND_URL()}/profile?tab=orders&card=update`;
  const html = card('About your next delivery', headline, [esc(body1), esc(body2)], { href: updateUrl, label: 'Update your card' });
  const text = [input.firstName ? `${input.firstName}, your card didn't go through.` : "Your card didn't go through.", '', body1, '', body2, '', `Update your card: ${updateUrl}`].join('\n');
  return { subject: 'About your next delivery', html, text };
}

export async function sendPaymentTroubleEmail(subscriptionId: string, invoiceId: string, attempt: number, amountCents: number | null): Promise<SendOnceResult> {
  const to = await recipientFor(subscriptionId);
  if (!to) throw new Error(`subscription ${subscriptionId}: the customer has no email address`);
  return sendOnce({
    to: to.email, kind: 'transactional', template: `subscription_payment_trouble:${invoiceId}:${attempt}`,
    ...renderPaymentTroubleEmail({ firstName: to.firstName, amountCents }),
  });
}

// ── self-service confirmations (Commerce 3, B6) ──────────────────────────────
// One short email per customer change, confirming what they asked for and how
// to change it again. Template subscription_<kind>:<eventId>, so each event
// emails once (an unchanged request records no event and sends nothing).

export type SelfServiceEmailKind = 'frequency_changed' | 'skipped' | 'paused' | 'resumed' | 'canceled' | 'card_updated';
export interface SelfServiceFacts { frequencyWeeks: number | null; nextDeliveryDate: string | null; skippedDate: string | null; resumesOn: string | null }

export function renderSelfServiceEmail(kind: SelfServiceEmailKind, input: SelfServiceFacts & { firstName: string | null }): { subject: string; html: string; text: string } {
  const who = (s: string) => (input.firstName ? `${input.firstName}, ${s.charAt(0).toLowerCase()}${s.slice(1)}` : s);
  const next = input.nextDeliveryDate ? longDate(input.nextDeliveryDate) : null;
  const every = input.frequencyWeeks ? `every ${input.frequencyWeeks} weeks` : null;
  const profileUrl = `${FRONTEND_URL()}/profile?tab=orders`;
  const nextLine = next ? `Your next coffee ships ${next}.` : null;
  const c: { subject: string; headline: string; body: Array<string | null> } = (() => {
    switch (kind) {
      case 'frequency_changed':
        return { subject: `Your coffee now comes ${every ?? 'on your new schedule'}`, headline: `Your coffee now comes ${every ?? 'on your new schedule'}.`,
          body: [next ? `Your next delivery stays on ${next}; after that, ${every}.` : null] };
      case 'skipped':
        return { subject: 'Your next delivery is skipped', headline: "Done: we'll skip this one.",
          body: [input.skippedDate ? `Nothing ships on ${longDate(input.skippedDate)}.` : null, nextLine] };
      case 'paused':
        return { subject: 'Your subscription is paused', headline: 'Your subscription is paused.',
          body: [input.resumesOn ? `We'll pick up again on ${longDate(input.resumesOn)}, and you can resume sooner from your profile any time.` : 'You can resume from your profile any time.'] };
      case 'resumed':
        return { subject: 'Your subscription is back on', headline: 'Welcome back: your coffee is on again.', body: [nextLine, every ? `Then ${every}.` : null] };
      case 'canceled':
        return { subject: 'Your subscription is canceled', headline: 'Your subscription is canceled.',
          body: ['Any bag you have already paid for still ships.', 'Your flavor profile and everything Liam knows about your taste stay with your account, ready whenever you want to start again from your cart.'] };
      case 'card_updated':
        return { subject: 'Your card is updated', headline: 'Your card is updated.', body: [next ? `We'll use it for your next delivery on ${next}.` : "We'll use it for your next delivery."] };
    }
  })();
  const body = c.body.filter((b): b is string => Boolean(b));
  const headline = who(c.headline);
  const link = { href: profileUrl, label: kind === 'canceled' ? 'Your profile' : 'See your subscription' };
  return {
    subject: c.subject,
    html: card(c.subject, esc(headline), body.map(esc), link),
    text: [headline, '', ...body, '', `${link.label}: ${link.href}`].join('\n'),
  };
}

const SELF_SERVICE_TEMPLATE: Record<SelfServiceEmailKind, string> = {
  frequency_changed: 'subscription_frequency_changed', skipped: 'subscription_skipped', paused: 'subscription_paused',
  resumed: 'subscription_resumed', canceled: 'subscription_canceled', card_updated: 'subscription_card_updated',
};

export async function sendSelfServiceEmail(kind: SelfServiceEmailKind, subscriptionId: string, eventId: number, facts: SelfServiceFacts): Promise<SendOnceResult> {
  const to = await recipientFor(subscriptionId);
  if (!to) throw new Error(`subscription ${subscriptionId}: the customer has no email address`);
  return sendOnce({
    to: to.email, kind: 'transactional', template: `${SELF_SERVICE_TEMPLATE[kind]}:${eventId}`,
    ...renderSelfServiceEmail(kind, { ...facts, firstName: to.firstName }),
  });
}

// ── admin (internal) ─────────────────────────────────────────────────────────

export async function sendAdminSubscriptionAttentionEmail(subscriptionId: string, cycleDate: string, reason: string): Promise<SendOnceResult> {
  const to = await commerceParamText('admin_alert_email');
  const text = `Subscription ${subscriptionId}: the renewal due ${cycleDate} was NOT charged.\n\nReason: ${reason}\n\nNothing was charged. Fix the catalog or the customer's address; the daily job tries again tomorrow.`;
  return sendOnce({
    to, kind: 'transactional', template: `admin_subscription_attention:${subscriptionId}:${cycleDate}`,
    subject: `Subscription renewal not charged: ${subscriptionId}`, html: `<pre style="${FONT};font-size:14px;">${esc(text)}</pre>`, text,
  });
}
