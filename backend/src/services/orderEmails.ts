// Commerce 1, B9 (2026-10-31) — the three order emails, sent through the one
// transactional_email_log door (transactionalEmail.sendOnce), deduped on
// recipient + template + order id:
//   order_confirmation:<orderId>          the customer's confirmation
//   admin_new_order:<orderId>              one per paid order to admin_alert_email (manual fulfillment)
//   admin_fulfillment_attention:<orderId>  a fulfillment attempt failed
// The customer email uses quizCompleteEmail.ts's card (beige card, red
// wordmark, Helvetica) and voice, no urgency; it carries house names only.
// The admin emails are internal and plain, and carry the resolved roaster
// coffee and roaster: the customer never sees a roaster name.
import { db } from '../db/client.js';
import admin from './firebase-admin.js';
import { commerceParamText } from './commerceParameters.js';
import { getOrderSummary, type OrderSummary } from './checkoutService.js';
import { sendOnce, type SendOnceResult } from './transactionalEmail.js';

const IMAGE_BASE = 'https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card';
const FRONTEND_URL = () => (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const FONT = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function shipsToLines(o: OrderSummary): string[] {
  const s = o.shipsTo;
  return [s.street, [s.city, [s.state, s.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '), s.country]
    .filter((x): x is string => Boolean(x));
}

function lineText(l: OrderSummary['lines'][number]): string {
  return `${l.quantity} × ${l.displayName ?? 'Coffee'}${l.weightOz ? ` · ${l.weightOz} oz` : ''}`;
}

// ── customer confirmation ────────────────────────────────────────────────────

export function renderOrderConfirmationEmail(o: OrderSummary): { subject: string; html: string; text: string } {
  const name = o.firstName ? esc(o.firstName) : null;
  const headline = name ? `${name}, your coffee is on its way to being roasted.` : 'Your coffee is on its way to being roasted.';
  const totals: Array<[string, string]> = [
    ['Subtotal', money(o.subtotalCents)],
    ['Shipping', o.shippingCents > 0 ? money(o.shippingCents) : 'Free'],
    ...(o.taxCents > 0 ? [['Tax', money(o.taxCents)] as [string, string]] : []),
    ['Total', money(o.totalCents)],
  ];
  const ordersUrl = `${FRONTEND_URL()}/profile?tab=orders`;
  const row = (left: string, right: string, bold = false) =>
    `<tr><td style="${FONT};font-size:15px;line-height:24px;color:#3b2f2a;${bold ? 'font-weight:bold;' : ''}padding:2px 0;">${left}</td>`
    + `<td align="right" style="${FONT};font-size:15px;line-height:24px;color:#3b2f2a;${bold ? 'font-weight:bold;' : ''}padding:2px 0;">${right}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your order is in</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff">
    <tr><td align="center" style="padding:34px 12px 48px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#f2f1ea" style="width:600px;max-width:600px;background-color:#f2f1ea;border:1px solid #c5c7c8;">
        <tr><td align="center" style="padding:46px 40px 0;"><img src="${IMAGE_BASE}/logo-quarter.png" width="26" alt="" style="display:block;border:0;width:26px;height:auto;" /></td></tr>
        <tr><td align="center" style="padding:14px 40px 0;${FONT};font-size:12px;letter-spacing:5px;color:#9a2918;font-weight:bold;">AXIS&nbsp;&amp;&nbsp;BLOOM</td></tr>
        <tr><td align="center" style="padding:38px 40px 0;${FONT};font-size:27px;line-height:38px;color:#9a2918;">${headline}</td></tr>
        <tr><td style="padding:30px 40px 0;">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
            ${o.lines.map(l => row(esc(lineText(l)), money(l.unitPriceCents * l.quantity))).join('\n            ')}
            <tr><td colspan="2" style="border-top:1px solid #c5c7c8;font-size:0;line-height:0;padding-top:10px;">&nbsp;</td></tr>
            ${totals.map(([k, v]) => row(k, v, k === 'Total')).join('\n            ')}
          </table>
        </td></tr>
        <tr><td style="padding:26px 40px 0;${FONT};font-size:12px;letter-spacing:2px;color:#9a2918;font-weight:bold;">SHIPS TO</td></tr>
        <tr><td style="padding:6px 40px 0;${FONT};font-size:15px;line-height:24px;color:#3b2f2a;">${shipsToLines(o).map(esc).join('<br />')}</td></tr>
        <tr><td style="padding:26px 40px 0;${FONT};font-size:15px;line-height:24px;color:#3b2f2a;">We'll write again when it ships.</td></tr>
        <tr><td style="padding:18px 40px 46px;${FONT};font-size:14px;line-height:22px;"><a href="${esc(ordersUrl)}" style="color:#9a2918;text-decoration:underline;">See your order</a></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    o.firstName ? `${o.firstName}, your coffee is on its way to being roasted.` : 'Your coffee is on its way to being roasted.',
    '',
    ...o.lines.map(l => `${lineText(l)}  ${money(l.unitPriceCents * l.quantity)}`),
    '',
    ...totals.map(([k, v]) => `${k}: ${v}`),
    '',
    'Ships to:',
    ...shipsToLines(o),
    '',
    "We'll write again when it ships.",
    `See your order: ${ordersUrl}`,
  ].join('\n');

  return { subject: 'Your order is in', html, text };
}

async function customerEmail(o: OrderSummary): Promise<string | null> {
  try { return (await admin.auth().getUser(o.firebaseUid)).email ?? null; }
  catch (err) {
    console.warn('[orderEmails] no Firebase email for order', o.orderId, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function sendOrderConfirmationEmail(orderId: string): Promise<SendOnceResult> {
  const o = await getOrderSummary(orderId);
  if (!o) throw new Error(`order ${orderId} not found`);
  const to = await customerEmail(o);
  if (!to) throw new Error(`order ${orderId}: the customer has no email address`);
  const result = await sendOnce({ to, kind: 'transactional', template: `order_confirmation:${orderId}`, ...renderOrderConfirmationEmail(o) });
  if (result.status === 'failed') throw new Error(`order ${orderId}: confirmation email failed`);
  return result;
}

// ── admin (internal) ─────────────────────────────────────────────────────────

interface InternalLine { blendId: string; coffeeName: string | null; roasterName: string | null; roasterSku: string | null }

async function internalLines(o: OrderSummary): Promise<Map<string, InternalLine>> {
  const r = await db.query<{ blend_id: string; coffee_name: string | null; roaster_name: string | null; roaster_sku: string | null }>(
    `SELECT sku.id AS blend_id, vc.name AS coffee_name, vc.roaster_name, sku.roaster_sku
     FROM coffee_sku sku LEFT JOIN v_coffee vc ON vc.id = sku.coffee_id
     WHERE sku.id = ANY($1::uuid[])`,
    [o.lines.map(l => l.blendId)]
  );
  return new Map(r.rows.map(row => [row.blend_id, { blendId: row.blend_id, coffeeName: row.coffee_name, roasterName: row.roaster_name, roasterSku: row.roaster_sku }]));
}

export async function renderAdminNewOrderEmail(o: OrderSummary): Promise<{ subject: string; html: string; text: string }> {
  const internal = await internalLines(o);
  const lines = o.lines.map(l => {
    const i = internal.get(l.blendId);
    return `${lineText(l)} — roaster coffee: ${i?.coffeeName ?? '?'} (${i?.roasterName ?? 'roaster unknown'}${i?.roasterSku ? `, SKU ${i.roasterSku}` : ''})`;
  });
  const text = [
    `New paid order ${o.orderId}`,
    `Paid: ${o.paidAt ?? o.createdAt}`,
    `Total: ${money(o.totalCents)} (subtotal ${money(o.subtotalCents)}, shipping ${money(o.shippingCents)}, tax ${money(o.taxCents)})`,
    `Stripe payment intent: ${o.stripePaymentIntentId ?? '-'}`,
    '',
    'Lines:',
    ...lines,
    '',
    'Ship to:',
    ...(o.firstName ? [o.firstName] : []),
    ...shipsToLines(o),
    '',
    'Manual fulfillment: place this with the roaster.',
  ].join('\n');
  return { subject: `New order: ${o.lines.reduce((n, l) => n + l.quantity, 0)} bag(s), ${money(o.totalCents)}`, html: `<pre style="${FONT};font-size:14px;">${esc(text)}</pre>`, text };
}

export async function sendAdminNewOrderEmail(o: OrderSummary): Promise<SendOnceResult> {
  const to = await commerceParamText('admin_alert_email');
  return sendOnce({ to, kind: 'transactional', template: `admin_new_order:${o.orderId}`, ...await renderAdminNewOrderEmail(o) });
}

export async function sendAdminFulfillmentAttentionEmail(orderId: string, error: string, attempts: number): Promise<SendOnceResult> {
  const to = await commerceParamText('admin_alert_email');
  const text = `Order ${orderId} needs attention: fulfillment attempt ${attempts} failed.\n\nError: ${error}\n\nThe order is paid; nothing was refunded. Place it by hand and check the logs.`;
  return sendOnce({
    to, kind: 'transactional', template: `admin_fulfillment_attention:${orderId}`,
    subject: `Order needs attention: ${orderId}`, html: `<pre style="${FONT};font-size:14px;">${esc(text)}</pre>`, text,
  });
}
