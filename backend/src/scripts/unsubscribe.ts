// Unsubscribe sync, Part 6 — the hello@ inbox path. Someone emails asking to be
// taken off the list: run this, no SQL by hand. Calls the same service the
// admin route uses (unsubscribeByEmail, source 'admin'): flips the DB row and
// pushes 'unsubscribed' to Mailchimp, then prints both systems before and after.
//
// Usage (from backend/, DATABASE_URL + MAILCHIMP_* pointed at prod):
//   npm run newsletter:unsubscribe -- someone@example.com
import 'dotenv/config';
import { db } from '../db/client.js';
import { MC_ENABLED, getMailchimpMemberStatus } from '../features/marketing/mailchimp.js';
import { unsubscribeByEmail } from '../features/marketing/unsubscribe.js';

async function snapshot(email: string) {
  const r = await db.query<{ subscribed: boolean | null; unsubscribed_at: Date | null; unsubscribe_source: string | null }>(
    `SELECT subscribed, unsubscribed_at, unsubscribe_source FROM newsletter_subscriber WHERE email = $1`,
    [email],
  );
  const row = r.rows[0];
  return {
    db: row
      ? `subscribed=${row.subscribed !== false}, unsubscribed_at=${row.unsubscribed_at?.toISOString() ?? 'null'}, source=${row.unsubscribe_source ?? 'null'}`
      : 'no newsletter_subscriber row',
    mailchimp: MC_ENABLED ? (await getMailchimpMemberStatus(email)) ?? 'not found (or read failed)' : 'disabled (MAILCHIMP_* not set)',
  };
}

async function main() {
  const email = process.argv.slice(2).find(a => !a.startsWith('--'))?.toLowerCase().trim();
  if (!email) {
    console.error('Usage: npm run newsletter:unsubscribe -- someone@example.com');
    process.exit(1);
  }

  const before = await snapshot(email);
  const result = await unsubscribeByEmail(email, 'admin');
  const after = await snapshot(email);

  console.log(`\n${email}`);
  console.log(`  before  DB: ${before.db}`);
  console.log(`          Mailchimp: ${before.mailchimp}`);
  console.log(`  after   DB: ${after.db}`);
  console.log(`          Mailchimp: ${after.mailchimp}`);
  console.log(
    result.ok
      ? `\n${result.wasSubscribed ? 'Unsubscribed.' : 'Was already unsubscribed in the DB — nothing changed there.'} Mailchimp push: ${result.mailchimpMirrored ? 'ok' : 'failed or not a member'}`
      : `\nNo newsletter_subscriber row for this address. Mailchimp push: ${result.mailchimpMirrored ? 'ok' : 'failed or not a member'}`
  );

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
