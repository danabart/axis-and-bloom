// Step 05 (C1): Mailchimp sync — member upsert (FNAME + ARCHETYPE merge fields) plus
// tag assignment (source/archetype/quiz-completed/experimental). Kept non-blocking and
// MC_ENABLED-guarded throughout, matching the existing subscribe flow's contract: a
// Mailchimp failure must never fail the signup request.

import crypto from 'crypto';

const MC_API_KEY = (process.env.MAILCHIMP_API_KEY ?? '').trim();
const MC_LIST_ID = process.env.MAILCHIMP_LIST_ID ?? '';
export const MC_ENABLED = Boolean(MC_API_KEY && MC_LIST_ID);
const MC_DC = MC_API_KEY.split('-')[1] ?? '';

function mcHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`,
  };
}

export function memberHash(email: string): string {
  // Mailchimp's documented member id: lowercase email, MD5 hex.
  return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
}

export interface MailchimpTagInputs {
  source?: string | null;
  archetype?: string | null;
  experimental?: boolean | null;
}

export function buildTags({ source, archetype, experimental }: MailchimpTagInputs): string[] {
  const tags: string[] = [];
  if (source) tags.push(`source:${source}`);
  if (archetype) tags.push(`archetype:${archetype}`);
  if (source === 'post_quiz') tags.push('quiz-completed');
  if (experimental) tags.push('experimental');
  return tags;
}

// One check (+ create, if missing) per process lifetime. Only cached on confirmed
// success so a transient failure gets retried on the next signup rather than silently
// leaving ARCHETYPE unmapped forever.
let archetypeMergeFieldReady = false;

async function ensureArchetypeMergeField(): Promise<void> {
  if (archetypeMergeFieldReady || !MC_ENABLED) return;
  try {
    const url = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/merge-fields`;
    const existing = await fetch(`${url}?count=100`, { headers: mcHeaders() });
    if (existing.ok) {
      const body = (await existing.json()) as { merge_fields?: { tag: string }[] };
      if (body.merge_fields?.some(f => f.tag === 'ARCHETYPE')) {
        archetypeMergeFieldReady = true;
        return;
      }
    }
    const created = await fetch(url, {
      method: 'POST',
      headers: mcHeaders(),
      body: JSON.stringify({ tag: 'ARCHETYPE', name: 'Archetype', type: 'text', required: false }),
    });
    if (created.ok) {
      archetypeMergeFieldReady = true;
    } else {
      console.error('[mailchimp] failed to ensure ARCHETYPE merge field:', created.status, await created.text());
    }
  } catch (err) {
    console.error('[mailchimp] ensureArchetypeMergeField error:', err);
  }
}

async function setMemberTags(hash: string, tags: string[]): Promise<boolean> {
  if (tags.length === 0) return true;
  const url = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}/tags`;
  const res = await fetch(url, {
    method: 'POST',
    headers: mcHeaders(),
    body: JSON.stringify({ tags: tags.map(name => ({ name, status: 'active' })) }),
  });
  if (!res.ok) {
    console.error('[mailchimp] tag error:', res.status, await res.text());
    return false;
  }
  return true;
}

/**
 * Upsert a member (FNAME + ARCHETYPE merge fields) and set their tags. Never throws on
 * a Mailchimp API error (logs and returns false) — the live signup route relies on this
 * to stay non-blocking; the backfill script relies on the boolean to count failures.
 */
export async function syncMailchimpMember(
  email: string,
  firstName: string,
  inputs: MailchimpTagInputs,
): Promise<boolean> {
  if (!MC_ENABLED) return true;
  await ensureArchetypeMergeField();

  const hash = memberHash(email);
  const url  = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`;
  const mergeFields: Record<string, string> = { FNAME: firstName };
  if (inputs.archetype) mergeFields.ARCHETYPE = inputs.archetype;

  const mcRes = await fetch(url, {
    method: 'PUT',
    headers: mcHeaders(),
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      status: 'subscribed',
      merge_fields: mergeFields,
    }),
  });
  if (!mcRes.ok) {
    console.error('[mailchimp] error:', mcRes.status, await mcRes.text());
    return false; // don't attempt tags against a member upsert that failed
  }

  return setMemberTags(hash, buildTags(inputs));
}
