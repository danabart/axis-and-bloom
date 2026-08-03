import { db } from '../db/client.js';

export interface SmsMessage {
  to: string;   // E.164 format: +15551234567
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

// HOME_TASK_8 (§3.1, spec item 5) — Twilio, via a plain REST call (no SDK
// dependency added — same "raw fetch over a heavy client" preference this
// codebase already shows for Mailchimp). Credentials from GCP Secret Manager
// (SMS_PROVIDER_ACCOUNT_SID, SMS_PROVIDER_AUTH_TOKEN, SMS_FROM_NUMBER —
// wired into deploy.yml --set-secrets, same pattern as CRON_SECRET), each
// currently a placeholder value until Dana has real Twilio credentials (see
// build log) — safe to reference in deploy.yml either way, since every real
// call site is gated behind config/sommelier.beats.smsEnabled=false regardless
// of whether the credentials are real. The provider interface (SmsMessage in,
// SmsSendResult out) is unchanged, per the task's own instruction, so a future
// provider swap still only touches this one function body.
export async function sendSms(message: SmsMessage): Promise<SmsSendResult> {
  const accountSid = process.env.SMS_PROVIDER_ACCOUNT_SID;
  const authToken = process.env.SMS_PROVIDER_AUTH_TOKEN;
  const fromNumber = process.env.SMS_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('[smsProvider] SMS provider not configured — message not sent to:', message.to);
    return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
  }

  try {
    const body = new URLSearchParams({ To: message.to, From: fromNumber, Body: message.body });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );
    const data = await response.json();
    if (!response.ok) {
      console.error('[smsProvider] Twilio send failed:', response.status, data?.message ?? data);
      return { success: false, error: data?.message ?? `Twilio error ${response.status}` };
    }
    return { success: true, providerMessageId: data.sid };
  } catch (err) {
    console.error('[smsProvider] Twilio send threw:', err);
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export async function logToNotificationLog(opts: {
  userId: string | null;
  channel: string;
  messageType: string;
  recipientContact: string;
  deliveryStatus: string;
  externalProviderId: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO notification_log
         (user_id, channel, message_type, recipient_contact, delivery_status, external_provider_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        opts.userId,
        opts.channel,
        opts.messageType,
        opts.recipientContact,
        opts.deliveryStatus,
        opts.externalProviderId,
        JSON.stringify(opts.metadata),
      ]
    );
  } catch (err) {
    console.error('[smsProvider] notification_log write failed:', err);
  }
}
