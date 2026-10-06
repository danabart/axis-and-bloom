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
// Unsubscribe sync (2026-10-01): the outward mirror is mocked too, so no test
// ever touches the real Mailchimp audience.
const setMailchimpStatus = vi.fn(async (_email: string, _status: 'unsubscribed' | 'subscribed') => true);
vi.mock('../features/marketing/mailchimp.js', async (importActual) => {
  const actual = await importActual<typeof import('../features/marketing/mailchimp.js')>();
  return { ...actual, syncMailchimpMember, setMailchimpStatus, MC_ENABLED: false };
});

const sendResendEmail = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, id: 'test-resend-id' }));
vi.mock('../features/marketing/resendEmail.js', () => ({ sendResendEmail }));

// optionalAuth/requireAdmin as pass-throughs: the admin door is exercised
// without a Firebase token (same precedent as admin.*.test.ts).
vi.mock('../middleware/auth.js', () => ({
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { default: newsletterRouter, sendQuizCompleteEmailOnce } = await import('./newsletter.js');
const { default: cronRouter } = await import('./cron.js');
const { default: adminRouter } = await import('./admin.js');
const { db } = await import('../db/client.js');
const { buildListUnsubscribeHeaders } = await vi.importActual<typeof import('../features/marketing/resendEmail.js')>('../features/marketing/resendEmail.js');

let server: Server;
let baseUrl: string;
let rootUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/newsletter', newsletterRouter);
  app.use('/api/webhooks', cronRouter);
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  rootUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  baseUrl = `${rootUrl}/api/newsletter`;
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

// ── Unsubscribe sync (2026-10-01, features/newsletter_unsubscribe/) ──────────
// Brief's test 2 said "GET flips subscribed=false"; that contradicts the
// brief's own Part 3 (and Dana's non-negotiable): GET never writes. So test 2
// asserts GET renders the confirm page with NO write, and the confirm form's
// POST is what flips with source 'link'.
describe('unsubscribe sync', () => {
  const U = (name: string) => `unsub-test-${name}@example.com`;
  const ALL = ['token', 'link', 'oneclick', 'unknown', 'suppressed', 'webhook', 'webhook-sub', 'admin'].map(U);
  const WEBHOOK_KEY = 'vitest-mailchimp-webhook-key';

  async function getRow(email: string) {
    const r = await db.query<{
      subscribed: boolean | null; unsubscribe_token: string | null; unsubscribed_at: Date | null; unsubscribe_source: string | null;
    }>(
      `SELECT subscribed, unsubscribe_token, unsubscribed_at, unsubscribe_source FROM newsletter_subscriber WHERE email = $1`,
      [email],
    );
    return r.rows[0] ?? null;
  }

  async function subscribed(email: string): Promise<string> {
    const { status } = await subscribe({ email, firstName: 'Unsub', source: 'newsletter' });
    expect(status).toBe(200);
    const row = await getRow(email);
    return row!.unsubscribe_token!;
  }

  function postForm(url: string, body: Record<string, string>) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }

  beforeAll(async () => {
    process.env.MAILCHIMP_WEBHOOK_KEY = WEBHOOK_KEY;
    await db.query(`DELETE FROM transactional_email_log WHERE email = ANY($1::text[])`, [ALL]);
    await db.query(`DELETE FROM newsletter_subscriber WHERE email = ANY($1::text[])`, [ALL]);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM transactional_email_log WHERE email = ANY($1::text[])`, [ALL]);
    await db.query(`DELETE FROM newsletter_subscriber WHERE email = ANY($1::text[])`, [ALL]);
    await db.query(`DELETE FROM quiz_funnel_event WHERE session_key LIKE 'unsub-test-%'`);
  });

  it('(1) subscribe mints a token; re-subscribe keeps it and clears a prior unsubscribe', async () => {
    const email = U('token');
    const token = await subscribed(email);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await db.query(
      `UPDATE newsletter_subscriber SET subscribed = false, unsubscribed_at = now(), unsubscribe_source = 'link' WHERE email = $1`,
      [email],
    );
    await subscribe({ email, firstName: 'Unsub', source: 'newsletter' });
    const row = await getRow(email);
    expect(row?.unsubscribe_token).toBe(token);
    expect(row?.subscribed).toBe(true);
    expect(row?.unsubscribed_at).toBeNull();
    expect(row?.unsubscribe_source).toBeNull();
  });

  it('(1b) a pre-backfill row with no token gets one on its next subscribe', async () => {
    const email = U('token');
    await db.query(`UPDATE newsletter_subscriber SET unsubscribe_token = NULL WHERE email = $1`, [email]);
    await subscribe({ email, firstName: 'Unsub', source: 'newsletter' });
    expect((await getRow(email))?.unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('(2) GET renders the confirm page and writes nothing; the form POST flips with source link, mirrors once', async () => {
    const email = U('link');
    const token = await subscribed(email);
    setMailchimpStatus.mockClear();

    const page = await fetch(`${baseUrl}/unsubscribe/${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Unsubscribe from Axis &amp; Bloom emails?');
    expect(html).toContain(`<form method="POST" action="/api/newsletter/unsubscribe/${token}"`);
    expect((await getRow(email))?.subscribed).toBe(true);
    expect(setMailchimpStatus).not.toHaveBeenCalled();

    const done = await postForm(`${baseUrl}/unsubscribe/${token}`, { confirm: '1' });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("You're unsubscribed.");
    const row = await getRow(email);
    expect(row?.subscribed).toBe(false);
    expect(row?.unsubscribed_at).not.toBeNull();
    expect(row?.unsubscribe_source).toBe('link');
    expect(setMailchimpStatus).toHaveBeenCalledTimes(1);
    expect(setMailchimpStatus).toHaveBeenCalledWith(email, 'unsubscribed');

    // Second click: 200 no-op, no second Mailchimp call, first time/source kept.
    const again = await postForm(`${baseUrl}/unsubscribe/${token}`, {});
    expect(again.status).toBe(200);
    const row2 = await getRow(email);
    expect(row2?.unsubscribed_at?.toISOString()).toBe(row?.unsubscribed_at?.toISOString());
    expect(row2?.unsubscribe_source).toBe('link');
    expect(setMailchimpStatus).toHaveBeenCalledTimes(1);

    // GET after unsubscribing still only renders the page.
    expect((await fetch(`${baseUrl}/unsubscribe/${token}`)).status).toBe(200);
  });

  it('(3) RFC 8058 one-click POST → 200 empty body, source one_click', async () => {
    const email = U('oneclick');
    const token = await subscribed(email);
    setMailchimpStatus.mockClear();

    const res = await postForm(`${baseUrl}/unsubscribe/${token}`, { 'List-Unsubscribe': 'One-Click' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    const row = await getRow(email);
    expect(row?.subscribed).toBe(false);
    expect(row?.unsubscribe_source).toBe('one_click');
    expect(setMailchimpStatus).toHaveBeenCalledTimes(1);
  });

  it('(4) unknown token → 404 on GET and POST, no DB change, no Mailchimp call', async () => {
    const email = U('unknown');
    await subscribed(email);
    setMailchimpStatus.mockClear();
    const unknown = 'f'.repeat(64);

    const get = await fetch(`${baseUrl}/unsubscribe/${unknown}`);
    expect(get.status).toBe(404);
    expect(await get.text()).toContain('That link is no longer valid.');
    expect((await fetch(`${baseUrl}/unsubscribe/not-a-token`)).status).toBe(404);
    expect((await postForm(`${baseUrl}/unsubscribe/${unknown}`, { confirm: '1' })).status).toBe(404);
    expect((await postForm(`${baseUrl}/unsubscribe/${unknown}`, { 'List-Unsubscribe': 'One-Click' })).status).toBe(404);

    expect((await getRow(email))?.subscribed).toBe(true);
    expect(setMailchimpStatus).not.toHaveBeenCalled();
  });

  it('(5) marketing send to a suppressed address: no Resend call, no claim row left; after re-subscribe it sends with the hosted URL', async () => {
    const email = U('suppressed');
    const sessionKey = 'unsub-test-suppressed-session';
    await seedFunnelEvent(sessionKey, 'quiz_complete', 'Floral');
    const token = await subscribed(email);
    await db.query(`DELETE FROM transactional_email_log WHERE email = $1`, [email]);
    await db.query(`UPDATE newsletter_subscriber SET subscribed = false WHERE email = $1`, [email]);
    sendResendEmail.mockClear();

    await sendQuizCompleteEmailOnce(email, 'Unsub', 'Floral');
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect(await getEmailLog(email)).toBeNull();

    // Re-subscribe through the real quiz path: the email now goes out.
    await subscribe({ email, firstName: 'Unsub', source: 'post_quiz', archetype: 'Floral', quizSessionKey: sessionKey });
    const log = await waitForEmailLog(email);
    expect(log?.archetype).toBe('Floral');
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
    const sent = sendResendEmail.mock.calls[0][0] as { kind: string; unsubscribeUrl: string; html: string; text: string };
    expect(sent.kind).toBe('marketing');
    expect(sent.unsubscribeUrl).toMatch(new RegExp(`/api/newsletter/unsubscribe/${token}$`));
    expect(sent.html).toContain(`href="${sent.unsubscribeUrl}"`);
    expect(sent.html).not.toContain('mailto:');
    expect(sent.text).toContain(`Unsubscribe: ${sent.unsubscribeUrl}`);
  });

  it('(6) Mailchimp webhook: right key + unsubscribe flips (no mirror back); wrong key 403; subscribe is a no-op', async () => {
    const email = U('webhook');
    await subscribed(email);
    setMailchimpStatus.mockClear();
    const hook = `${rootUrl}/api/webhooks/mailchimp`;

    const wrong = await postForm(`${hook}?key=nope`, { type: 'unsubscribe', 'data[email]': email });
    expect(wrong.status).toBe(403);
    expect((await postForm(hook, { type: 'unsubscribe', 'data[email]': email })).status).toBe(403);
    expect((await getRow(email))?.subscribed).toBe(true);

    expect((await fetch(`${hook}?key=${WEBHOOK_KEY}`)).status).toBe(200); // Mailchimp's save-time validation GET
    expect((await fetch(`${hook}?key=nope`)).status).toBe(403);

    const ok = await postForm(`${hook}?key=${WEBHOOK_KEY}`, {
      type: 'unsubscribe', 'data[email]': email.toUpperCase(), 'data[reason]': 'manual', 'data[action]': 'unsub',
    });
    expect(ok.status).toBe(200);
    const row = await getRow(email);
    expect(row?.subscribed).toBe(false);
    expect(row?.unsubscribe_source).toBe('mailchimp');
    expect(setMailchimpStatus).not.toHaveBeenCalled();

    const other = U('webhook-sub');
    await subscribed(other);
    await db.query(`UPDATE newsletter_subscriber SET subscribed = false WHERE email = $1`, [other]);
    const sub = await postForm(`${hook}?key=${WEBHOOK_KEY}`, { type: 'subscribe', 'data[email]': other });
    expect(sub.status).toBe(200);
    expect((await getRow(other))?.subscribed).toBe(false); // never flips toward subscribed
  });

  it('(6b) Mailchimp webhook: cleaned also flips', async () => {
    const email = U('webhook-sub');
    await db.query(`UPDATE newsletter_subscriber SET subscribed = true, unsubscribe_source = NULL, unsubscribed_at = NULL WHERE email = $1`, [email]);
    const res = await postForm(`${rootUrl}/api/webhooks/mailchimp?key=${WEBHOOK_KEY}`, { type: 'cleaned', 'data[email]': email, 'data[reason]': 'hard' });
    expect(res.status).toBe(200);
    expect((await getRow(email))?.unsubscribe_source).toBe('mailchimp');
  });

  it('(7) admin door flips + mirrors; wasSubscribed false on the second call; lookup shows the row', async () => {
    const email = U('admin');
    await subscribed(email);
    setMailchimpStatus.mockClear();
    const post = (body: unknown) => fetch(`${rootUrl}/api/admin/newsletter/unsubscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    const first = await (await post({ email: ` ${email.toUpperCase()} ` })).json();
    expect(first).toMatchObject({ ok: true, email, wasSubscribed: true });
    expect(setMailchimpStatus).toHaveBeenCalledWith(email, 'unsubscribed');
    expect((await getRow(email))?.unsubscribe_source).toBe('admin');

    const second = await (await post({ email })).json();
    expect(second).toMatchObject({ ok: true, wasSubscribed: false });

    expect((await post({})).status).toBe(400);

    const lookup = await (await fetch(`${rootUrl}/api/admin/newsletter/subscriber?email=${encodeURIComponent(email)}`)).json();
    expect(lookup.subscriber).toMatchObject({ email, subscribed: false, unsubscribe_source: 'admin', source: 'newsletter' });
    expect(lookup.mailchimpStatus).toBeNull(); // MC_ENABLED mocked false
  });

  it('(8) List-Unsubscribe header builder: both targets, exact -Post value', () => {
    const url = 'https://www.axisandbloomcoffee.com/api/newsletter/unsubscribe/abc';
    expect(buildListUnsubscribeHeaders(url)).toEqual({
      'List-Unsubscribe': `<${url}>, <mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(buildListUnsubscribeHeaders()).toEqual({
      'List-Unsubscribe': '<mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe>',
    });
  });
});
