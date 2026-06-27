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

// TODO: replace with Twilio or chosen provider when credentials are available.
// Credentials will live in GCP Secret Manager under SMS_PROVIDER_ACCOUNT_SID,
// SMS_PROVIDER_AUTH_TOKEN, SMS_FROM_NUMBER.
export async function sendSms(message: SmsMessage): Promise<SmsSendResult> {
  console.warn('[smsProvider] SMS provider not configured — message not sent to:', message.to);
  return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
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
