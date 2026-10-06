// Unsubscribe sync (2026-10-01, features/newsletter_unsubscribe/) —
// newsletter_subscriber.subscribed is the single source of truth for marketing
// consent. Every unsubscribe, wherever it starts, lands here and is mirrored
// outward:
//   link in our email (confirm page POST)   -> source 'link'      -> Mailchimp
//   mail client one-click (RFC 8058 POST)   -> source 'one_click' -> Mailchimp
//   Mailchimp footer (webhook)              -> source 'mailchimp' -> (MC already knows)
//   hello@ request (admin route / script)   -> source 'admin'     -> Mailchimp
// Rows are flipped, never deleted. The Mailchimp mirror never fails the
// caller: setMailchimpStatus logs and returns false, it never throws.
//
// TODO (out of scope): if Resend Audiences/Broadcasts are ever adopted, mirror
// `subscribed` into the contact's `unsubscribed` flag from here too —
// PATCH /audiences/{id}/contacts/{email}.

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { setMailchimpStatus } from './mailchimp.js';

export type UnsubscribeSource = 'link' | 'one_click' | 'mailchimp' | 'admin';

export type UnsubscribeResult =
  | { ok: true; email: string; wasSubscribed: boolean; mailchimpMirrored: boolean | null }
  | { ok: false; mailchimpMirrored?: boolean };

/** 32 random bytes, hex — the same shape as beat_event.respond_token. */
export function generateUnsubscribeToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/** Cheap pre-check so an obviously malformed token never costs a query. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

/** Hosted unsubscribe URL. The site domain proxies /api to Cloud Run (firebase.json). */
export function buildUnsubscribeUrl(token: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/api/newsletter/unsubscribe/${token}`;
}

/** Read-only: decides between the confirm page and the 404 page. Never writes. */
export async function unsubscribeTokenExists(token: string): Promise<boolean> {
  if (!isWellFormedToken(token)) return false;
  const r = await db.query(`SELECT 1 FROM newsletter_subscriber WHERE unsubscribe_token = $1`, [token]);
  return (r.rowCount ?? 0) > 0;
}

/** Unknown emails are not suppressed. */
export async function isSuppressed(email: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM newsletter_subscriber WHERE email = $1 AND subscribed = false`,
    [email.toLowerCase().trim()],
  );
  return (r.rowCount ?? 0) > 0;
}

// One UPDATE, keyed by either column. The CTE reads the pre-update row so the
// caller learns whether this call changed anything (wasSubscribed). The
// COALESCEs keep the first unsubscribe's time and source on a repeat.
async function flip(
  column: 'unsubscribe_token' | 'email',
  key: string,
  source: UnsubscribeSource,
): Promise<{ email: string; wasSubscribed: boolean } | null> {
  const r = await db.query<{ email: string; was_subscribed: boolean | null }>(
    `WITH prev AS (
       SELECT email, subscribed FROM newsletter_subscriber WHERE ${column} = $1 FOR UPDATE
     )
     UPDATE newsletter_subscriber ns
        SET subscribed         = false,
            unsubscribed_at    = COALESCE(ns.unsubscribed_at, now()),
            unsubscribe_source = COALESCE(ns.unsubscribe_source, $2)
       FROM prev
      WHERE ns.email = prev.email
     RETURNING ns.email, prev.subscribed AS was_subscribed`,
    [key, source],
  );
  const row = r.rows[0];
  if (!row) return null;
  // subscribed is nullable (DEFAULT true) — NULL counts as subscribed.
  return { email: row.email, wasSubscribed: row.was_subscribed !== false };
}

function mirror(email: string): Promise<boolean> {
  return setMailchimpStatus(email, 'unsubscribed').catch(err => {
    console.error('[unsubscribe] mailchimp mirror error:', err);
    return false;
  });
}

/**
 * Capability-link path (confirm page POST and RFC 8058 one-click). Idempotent:
 * a second call is a no-op that still returns ok, and only a call that actually
 * flipped the row mirrors to Mailchimp (fire-and-forget — the response never
 * waits on Mailchimp). A mirror that failed is caught later by the reconcile
 * job's mismatch_outward pass.
 */
export async function unsubscribeByToken(token: string, source: 'link' | 'one_click'): Promise<UnsubscribeResult> {
  if (!isWellFormedToken(token)) return { ok: false };
  const flipped = await flip('unsubscribe_token', token, source);
  if (!flipped) return { ok: false };
  if (flipped.wasSubscribed) void mirror(flipped.email);
  return { ok: true, ...flipped, mailchimpMirrored: null };
}

/**
 * Email-keyed path, for the Mailchimp webhook and the admin door.
 *   'mailchimp' — never calls back into Mailchimp (it already knows; avoids a loop).
 *   'admin'     — always pushes to Mailchimp and waits for it (an operator acting
 *                 on an inbox request wants both systems right, even if the DB
 *                 already was), including for an address that has no DB row.
 */
export async function unsubscribeByEmail(email: string, source: 'mailchimp' | 'admin'): Promise<UnsubscribeResult> {
  const clean = email.toLowerCase().trim();
  if (!clean) return { ok: false };
  const flipped = await flip('email', clean, source);
  if (source === 'admin') {
    const mailchimpMirrored = await mirror(clean);
    return flipped ? { ok: true, ...flipped, mailchimpMirrored } : { ok: false, mailchimpMirrored };
  }
  return flipped ? { ok: true, ...flipped, mailchimpMirrored: null } : { ok: false };
}
