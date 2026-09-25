// Quiz Resync Fix Part E2 (a-d) — server-verified archetype (Part B1) against
// a real HTTP server + real DB (axisandbloom_test). Mailchimp and Resend are
// mocked (not merely env-disabled) so this suite never depends on — or risks
// hitting — the real accounts regardless of what .env happens to hold;
// toArchetypeSlug is kept real (imported via importActual) since Part B1's
// own verification logic depends on it.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const syncMailchimpMember = vi.fn(async () => true);
vi.mock('../features/marketing/mailchimp.js', async (importActual) => {
  const actual = await importActual<typeof import('../features/marketing/mailchimp.js')>();
  return { ...actual, syncMailchimpMember };
});

const sendResendEmail = vi.fn(async () => ({ ok: true, id: 'test-resend-id' }));
vi.mock('../features/marketing/resendEmail.js', () => ({ sendResendEmail }));

const { default: newsletterRouter } = await import('./newsletter.js');
const { db } = await import('../db/client.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/newsletter', newsletterRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}/api/newsletter`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function subscribe(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function seedFunnelEvent(sessionKey: string, event: 'quiz_complete' | 'quiz_final', archetype: string) {
  await db.query(
    `INSERT INTO quiz_funnel_event (session_key, event, archetype) VALUES ($1, $2, $3)`,
    [sessionKey, event, archetype],
  );
}

async function getSubscriber(email: string) {
  const r = await db.query<{ archetype: string | null }>(`SELECT archetype FROM newsletter_subscriber WHERE email = $1`, [email]);
  return r.rows[0] ?? null;
}

async function getEmailLog(email: string) {
  const r = await db.query<{ archetype: string | null; resend_message_id: string | null }>(
    `SELECT archetype, resend_message_id FROM transactional_email_log WHERE email = $1 AND template = 'quiz_complete_v2'`,
    [email],
  );
  return r.rows[0] ?? null;
}

// sendQuizCompleteEmailOnce is fire-and-forget (handleSubscribe never awaits
// it, by design — a slow/failed Resend send must never delay or fail the
// subscribe response), so the response resolving is not proof the claim row
// has been updated yet. Poll briefly rather than asserting immediately.
async function waitForEmailLog(email: string, timeoutMs = 2000): Promise<ReturnType<typeof getEmailLog> extends Promise<infer T> ? T : never> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = await getEmailLog(email);
    if (log?.archetype) return log;
    if (Date.now() > deadline) return log;
    await new Promise(r => setTimeout(r, 25));
  }
}

describe('POST /api/newsletter/subscribe — Part B1 server-verified archetype', () => {
  beforeAll(() => { syncMailchimpMember.mockClear(); sendResendEmail.mockClear(); });

  it('(a) post_quiz + archetype + a session key with no funnel rows at all → archetype rejected, no email', async () => {
    const email = 'part-e2-a@example.com';
    const sessionKey = 'part-e2-a-session-no-funnel-rows';

    const { status, body } = await subscribe({
      email, firstName: 'Testa', source: 'post_quiz', archetype: 'Chocolate & Nutty', quizSessionKey: sessionKey,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const subscriber = await getSubscriber(email);
    expect(subscriber?.archetype ?? null).toBeNull();
    expect(await getEmailLog(email)).toBeNull();
  });

  it('(b) post_quiz + archetype + a matching quiz_complete row → archetype written, email log has archetype + resend id', async () => {
    const email = 'part-e2-b@example.com';
    const sessionKey = 'part-e2-b-session-matching-complete';
    await seedFunnelEvent(sessionKey, 'quiz_complete', 'Chocolate & Nutty');

    const { status, body } = await subscribe({
      email, firstName: 'Testb', source: 'post_quiz', archetype: 'Chocolate & Nutty', quizSessionKey: sessionKey,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const subscriber = await getSubscriber(email);
    expect(subscriber?.archetype).toBe('Chocolate & Nutty');
    const log = await waitForEmailLog(email);
    expect(log?.archetype).toBe('Chocolate & Nutty');
    expect(log?.resend_message_id).toBe('test-resend-id');
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
  });

  it('(c) claimed archetype does not match the session\'s scored archetype → rejected', async () => {
    const email = 'part-e2-c@example.com';
    const sessionKey = 'part-e2-c-session-mismatch';
    await seedFunnelEvent(sessionKey, 'quiz_complete', 'Earthy');

    const { status, body } = await subscribe({
      email, firstName: 'Testc', source: 'post_quiz', archetype: 'Chocolate & Nutty', quizSessionKey: sessionKey,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true }); // subscribe itself still succeeds
    const subscriber = await getSubscriber(email);
    expect(subscriber?.archetype ?? null).toBeNull();
    expect(await getEmailLog(email)).toBeNull();
  });

  it('(d) branch case: quiz_complete says Chocolate & Nutty, quiz_final says Earthy, submit Earthy → accepted', async () => {
    const email = 'part-e2-d@example.com';
    const sessionKey = 'part-e2-d-session-branched';
    await seedFunnelEvent(sessionKey, 'quiz_complete', 'Chocolate & Nutty');
    await seedFunnelEvent(sessionKey, 'quiz_final', 'Earthy');

    const { status, body } = await subscribe({
      email, firstName: 'Testd', source: 'post_quiz', archetype: 'Earthy', quizSessionKey: sessionKey,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const subscriber = await getSubscriber(email);
    expect(subscriber?.archetype).toBe('Earthy');
    const log = await waitForEmailLog(email);
    expect(log?.archetype).toBe('Earthy');
  });

  afterAll(async () => {
    const emails = ['part-e2-a@example.com', 'part-e2-b@example.com', 'part-e2-c@example.com', 'part-e2-d@example.com'];
    await db.query(`DELETE FROM transactional_email_log WHERE email = ANY($1::text[])`, [emails]);
    await db.query(`DELETE FROM newsletter_subscriber WHERE email = ANY($1::text[])`, [emails]);
    await db.query(`DELETE FROM quiz_funnel_event WHERE session_key LIKE 'part-e2-%'`);
  });
});
