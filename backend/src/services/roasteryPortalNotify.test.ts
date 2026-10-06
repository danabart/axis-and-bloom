// Roastery portal part 2, F3 — the submit email. The Resend call is MOCKED here: a test run must never
// send a real email (the test database is a clone of prod and carries the real admins' addresses).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const send = vi.fn();
vi.mock('../features/marketing/resendEmail.js', () => ({
  RESEND_ENABLED: true,
  sendResendEmail: (...args: unknown[]) => send(...args),
}));

const { db } = await import('../db/client.js');
const { notifySubmission, SUBMIT_TEMPLATE_PREFIX } = await import('./roasteryPortalNotify.js');
const { createLink, upsertRespondent, addLineupCoffee, saveDraft, submitResponse, deactivateLineupCoffee, revokeLink } = await import('./roasteryPortalService.js');
const { listAdminEmails } = await import('./roasteryPortalReads.js');

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TEST_ADMIN_EMAIL = `zzz-test-notify-${RUN}@example.test`;
let adminProfileId: string; let adminTypeId: string; let customerTypeId: string;
let roasterId: string; let linkId: string; let lineupId: string; let responseId: string;

beforeAll(async () => {
  adminTypeId = (await db.query(`SELECT id FROM user_type WHERE name = 'admin'`)).rows[0].id;
  customerTypeId = (await db.query(`SELECT id FROM user_type WHERE name = 'customer'`)).rows[0].id;
  adminProfileId = (await db.query(
    `INSERT INTO user_profile (firebase_uid, first_name, user_type_id) VALUES ($1, 'Zzz Test Notify', $2) RETURNING id`,
    [`vitest-zzz-notify-${RUN}`, adminTypeId]
  )).rows[0].id;
  await db.query(`INSERT INTO user_email (user_id, email_address, is_primary) VALUES ($1, $2, true)`, [adminProfileId, TEST_ADMIN_EMAIL]);

  roasterId = (await db.query(`SELECT id FROM roaster WHERE name = 'Portal Test Roastery A'`)).rows[0]?.id
    ?? (await db.query(`INSERT INTO roaster (name, is_active) VALUES ('Portal Test Roastery A', true) RETURNING id`)).rows[0].id;
  linkId = (await createLink({ roasterId, adminFirebaseUid: 'vitest-no-such-admin' })).id;
  const person = await upsertRespondent({ roasterId, linkId, name: 'Ann <b>Tester</b>', email: `ann-notify-${RUN}@example.com` });
  lineupId = (await addLineupCoffee({ roasterId, name: `PT Notify ${RUN}`, addedBy: 'admin' })).id;
  await saveDraft({ roasterId, portalCoffeeId: lineupId, respondentId: person.id, doc: {} });
  responseId = (await submitResponse({ roasterId, portalCoffeeId: lineupId, respondentId: person.id })).responseId;
});

afterAll(async () => {
  // Nothing is deleted: the test admin loses its admin type (and its email row, which is not a record of anything).
  await db.query(`UPDATE user_profile SET user_type_id = $1 WHERE id = $2`, [customerTypeId, adminProfileId]);
  await db.query(`DELETE FROM user_email WHERE user_id = $1`, [adminProfileId]);
  await deactivateLineupCoffee({ roasterId, portalCoffeeId: lineupId }).catch(() => undefined);
  await revokeLink(linkId).catch(() => undefined);
});

describe('the submit notification', () => {
  it('resolves recipients from the admin user type at send time', async () => {
    expect(await listAdminEmails()).toContain(TEST_ADMIN_EMAIL);
  });

  it('sends "<Roastery>: <coffee> submitted by <name>" with the admin link, logs one row per address, and is a no-op the second time', async () => {
    send.mockReset();
    send.mockResolvedValue({ ok: true, id: 'msg_test_1' });
    const r1 = await notifySubmission(responseId);
    expect(r1.failed).toBe(0);
    expect(r1.sent).toBeGreaterThan(0);
    const mine = send.mock.calls.map(c => c[0] as { to: string; subject: string; html: string; text: string }).find(m => m.to === TEST_ADMIN_EMAIL)!;
    expect(mine.subject).toBe(`Portal Test Roastery A: PT Notify ${RUN} submitted by Ann <b>Tester</b>`);
    expect(mine.text).toContain(`/admin/roastery-portal?roastery=${roasterId}&coffee=${lineupId}`);
    expect(mine.html).not.toContain('<b>Tester</b>'); // names are escaped in the html body
    const log = await db.query(`SELECT email, template, resend_message_id FROM transactional_email_log WHERE email = $1 AND template = $2`, [TEST_ADMIN_EMAIL, `${SUBMIT_TEMPLATE_PREFIX}${responseId}`]);
    expect(log.rows).toEqual([{ email: TEST_ADMIN_EMAIL, template: `${SUBMIT_TEMPLATE_PREFIX}${responseId}`, resend_message_id: 'msg_test_1' }]);

    send.mockClear();
    const r2 = await notifySubmission(responseId);
    expect(r2.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed send never throws and releases its claim so a later attempt can still send', async () => {
    await db.query(`DELETE FROM transactional_email_log WHERE template = $1`, [`${SUBMIT_TEMPLATE_PREFIX}${responseId}`]);
    send.mockReset();
    send.mockResolvedValue({ ok: false, id: null });
    const r = await notifySubmission(responseId);
    expect(r.sent).toBe(0);
    expect(r.failed).toBeGreaterThan(0);
    const left = await db.query(`SELECT 1 FROM transactional_email_log WHERE template = $1`, [`${SUBMIT_TEMPLATE_PREFIX}${responseId}`]);
    expect(left.rows).toHaveLength(0);
    send.mockRejectedValue(new Error('network down'));
    await expect(notifySubmission(responseId)).resolves.toBeTruthy(); // a thrown send is swallowed, not rethrown
  });
});
