// Family Household 3 (2026-11-07) — the household's own mail, all through the
// one transactional door (transactionalEmail.sendOnce), each to the person's
// sign-in address (the Firebase Auth record, as every customer email;
// Dana's decision 5). Nobody without a sign-in is ever emailed (D31); the
// buyer never gets a member notice (T8); no roaster name (G4.5); positive
// register (G4.4). Keys carry the row they are about, so a send happens once:
//   household_bag_ordered:<order line id>           a member's bag was ordered (D13)
//   household_bag_shipped:<order line id>           it shipped (D13)
//   household_handover:<event id>:<member id>       the house subscription ended; the offer (D22)
//   household_items_skipped:<subscription>:<cycle>  the payer: a bag was skipped this cycle (D11, decision 1)
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_3_ORDER_FOR_THE_HOUSE.md
import { db } from '../db/client.js';
import admin from './firebase-admin.js';
import { sendOnce, type SendOnceResult } from './transactionalEmail.js';
import { directDisplay } from './cartResolver.js';
import { archetypeLabel } from './catalogReads.js';
import { MANAGED_UID_PREFIX } from './householdManaged.js';

const IMAGE_BASE = 'https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card';
const FRONTEND_URL = () => (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const FONT = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The order emails' card (orderEmails.ts): beige card, red wordmark, one headline, body lines, one link. */
function card(title: string, headline: string, body: string[], link: { href: string; label: string }): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff">
    <tr><td align="center" style="padding:34px 12px 48px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#f2f1ea" style="width:600px;max-width:600px;background-color:#f2f1ea;border:1px solid #c5c7c8;">
        <tr><td align="center" style="padding:46px 40px 0;"><img src="${IMAGE_BASE}/logo-quarter.png" width="26" alt="" style="display:block;border:0;width:26px;height:auto;" /></td></tr>
        <tr><td align="center" style="padding:14px 40px 0;${FONT};font-size:12px;letter-spacing:5px;color:#9a2918;font-weight:bold;">AXIS&nbsp;&amp;&nbsp;BLOOM</td></tr>
        <tr><td align="center" style="padding:38px 40px 0;${FONT};font-size:27px;line-height:38px;color:#9a2918;">${esc(headline)}</td></tr>
        <tr><td style="padding:30px 40px 0;${FONT};font-size:15px;line-height:24px;color:#3b2f2a;">${body.map(esc).join('<br />')}</td></tr>
        <tr><td style="padding:26px 40px 46px;${FONT};font-size:14px;line-height:22px;"><a href="${esc(link.href)}" style="color:#9a2918;text-decoration:underline;">${esc(link.label)}</a></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { html, text: [headline, '', ...body, '', `${link.label}: ${link.href}`].join('\n') };
}

/** The sign-in address of a profile's canonical account; null for a managed profile or no Firebase record (D31). */
async function signInEmail(firebaseUid: string | null): Promise<string | null> {
  if (!firebaseUid || firebaseUid.startsWith(MANAGED_UID_PREFIX)) return null;
  try { return (await admin.auth().getUser(firebaseUid)).email ?? null; }
  catch { return null; }
}

interface MemberLine {
  line_id: string; coffee_id: number | null; display_name: string | null; weight_oz: string | null; quantity: number;
  drinker_uid: string | null; drinker_first_name: string | null; buyer_first_name: string | null; drinker_managed: boolean;
}

/** Lines of an order bought for someone other than the buyer, with the drinker's canonical account. */
async function memberLines(orderId: string): Promise<MemberLine[]> {
  const r = await db.query<MemberLine>(
    `SELECT oli.id AS line_id, s.coffee_id, oli.display_name, oli.weight_oz::text AS weight_oz, oli.quantity,
            cup.firebase_uid AS drinker_uid, COALESCE(NULLIF(trim(cup.first_name), ''), mup.first_name) AS drinker_first_name,
            bup.first_name AS buyer_first_name,
            COALESCE(ut.name = 'household_managed', false) AS drinker_managed
     FROM order_line_item oli
     JOIN "order" o ON o.id = oli.order_id
     LEFT JOIN coffee_sku s ON s.id = oli.blend_id
     JOIN v_customer_identity dv ON dv.user_id = oli.intended_for_user_id
     JOIN v_customer_identity bv ON bv.user_id = o.user_id
     JOIN user_profile cup ON cup.id = dv.canonical_user_id
     JOIN user_profile mup ON mup.id = oli.intended_for_user_id
     JOIN user_profile bup ON bup.id = o.user_id
     LEFT JOIN user_type ut ON ut.id = cup.user_type_id
     WHERE oli.order_id = $1 AND dv.canonical_user_id <> bv.canonical_user_id
     ORDER BY oli.id`, [orderId]
  );
  return r.rows;
}

async function coffeeWords(l: MemberLine): Promise<string> {
  let family: string | null = null;
  if (l.coffee_id) {
    const { archetype } = await directDisplay(l.coffee_id).catch(() => ({ archetype: null as string | null }));
    family = archetype ? await archetypeLabel(archetype).catch(() => null) : null;
  }
  return `${l.quantity} × ${l.display_name ?? 'Coffee'}${l.weight_oz ? ` · ${Number(l.weight_oz)} oz` : ''}${family ? ` · ${family}` : ''}`;
}

/** D13: each member with a sign-in hears that their coffee is ordered (one email per line). The buyer is skipped (T8). */
export async function sendHouseholdBagOrderedEmails(orderId: string): Promise<SendOnceResult[]> {
  const out: SendOnceResult[] = [];
  for (const l of await memberLines(orderId)) {
    if (l.drinker_managed) continue;
    const to = await signInEmail(l.drinker_uid);
    if (!to) continue;
    const who = l.buyer_first_name ?? 'Your household';
    const headline = l.drinker_first_name ? `${l.drinker_first_name}, ${who} ordered coffee matched to you.` : `${who} ordered coffee matched to you.`;
    const { html, text } = card('Coffee for you', headline, [await coffeeWords(l), '', 'It travels in the household box.'],
      { href: `${FRONTEND_URL()}/profile?tab=family`, label: 'Your Family Household' });
    out.push(await sendOnce({ to, kind: 'transactional', template: `household_bag_ordered:${l.line_id}`, subject: 'Coffee matched to you is ordered', html, text }));
  }
  return out;
}

/** D13: and when it ships. */
export async function sendHouseholdBagShippedEmails(orderId: string): Promise<SendOnceResult[]> {
  const out: SendOnceResult[] = [];
  for (const l of await memberLines(orderId)) {
    if (l.drinker_managed) continue;
    const to = await signInEmail(l.drinker_uid);
    if (!to) continue;
    const headline = l.drinker_first_name ? `${l.drinker_first_name}, your coffee is on its way.` : 'Your coffee is on its way.';
    const { html, text } = card('Your coffee is on its way', headline, [await coffeeWords(l), '', 'It travels in the household box.'],
      { href: `${FRONTEND_URL()}/profile?tab=family`, label: 'Your Family Household' });
    out.push(await sendOnce({ to, kind: 'transactional', template: `household_bag_shipped:${l.line_id}`, subject: 'Your coffee is on its way', html, text }));
  }
  return out;
}

/** D22: the house subscription ended with the admin's leave; the member can start it on their side with the perk. */
export async function sendHandoverEmail(input: {
  eventId: string; memberId: string; firebaseUid: string | null; firstName: string | null; householdName: string | null;
  boxLines: string[]; pct: number; expiresAt: string;
}): Promise<SendOnceResult | null> {
  const to = await signInEmail(input.firebaseUid);
  if (!to) return null;
  const until = new Date(input.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  const headline = input.firstName ? `${input.firstName}, keep the household box coming.` : 'Keep the household box coming.';
  const body = [
    `${input.householdName ?? 'Your household'}'s box can continue on your side.`,
    '',
    ...input.boxLines,
    '',
    `Start a subscription by ${until} and your first box takes an extra ${input.pct}% on top of the subscription price.`,
  ];
  const { html, text } = card('Keep the household box coming', headline, body, { href: `${FRONTEND_URL()}/profile?tab=family`, label: 'Start it on your side' });
  return sendOnce({ to, kind: 'transactional', template: `household_handover:${input.eventId}:${input.memberId}`, subject: 'Keep the household box coming', html, text });
}

/** D11 / decision 1: the payer hears, once per cycle, which bags were left out and why. */
export async function sendItemsSkippedEmail(input: {
  subscriptionId: string; cycleDate: string; payerFirebaseUid: string | null; payerFirstName: string | null; reasons: string[];
}): Promise<SendOnceResult | null> {
  const to = await signInEmail(input.payerFirebaseUid);
  if (!to) return null;
  const headline = input.payerFirstName ? `${input.payerFirstName}, your household box is on its way.` : 'Your household box is on its way.';
  const body = [
    'This delivery ships everyone it can. These bags sit this one out:',
    ...input.reasons.map(r => `· ${r}`),
    '',
    'Take the quiz for a member, or drop their bag, from the Family Household tab.',
  ];
  const { html, text } = card('Your household box', headline, body, { href: `${FRONTEND_URL()}/profile?tab=family`, label: 'Family Household' });
  return sendOnce({ to, kind: 'transactional', template: `household_items_skipped:${input.subscriptionId}:${input.cycleDate}`, subject: 'Your household box is on its way', html, text });
}
