// Unsubscribe sync, Part 7 — CLI for the DB <-> Mailchimp consent reconcile
// (features/marketing/newsletterReconcile.ts; same logic as
// GET /api/cron/newsletter-reconcile). Dry run is the default.
//
// Usage (from backend/, DATABASE_URL + MAILCHIMP_* pointed at prod):
//   npm run newsletter:reconcile -- --dry-run
//   npm run newsletter:reconcile -- --apply
import 'dotenv/config';
import { db } from '../db/client.js';
import { reconcileNewsletter } from '../features/marketing/newsletterReconcile.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const report = await reconcileNewsletter({ apply });

  if (!report.mailchimpEnabled) {
    console.error('MAILCHIMP_API_KEY / MAILCHIMP_LIST_ID not set — nothing to reconcile.');
    await db.end();
    process.exit(1);
  }

  console.log(`\n${report.dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  console.log(`Mailchimp unsubscribed/cleaned:  ${report.counted}`);
  console.log(`  ${report.dryRun ? 'would flip' : 'flipped'} in DB:       ${report.flipped}`);
  console.log(`  already in sync:          ${report.alreadyInSync}`);
  console.log(`  not in DB:                ${report.notInDb}`);
  console.log(`mismatch_outward (DB off, MC on): ${report.mismatchOutward}`);
  if (!report.dryRun) console.log(`  pushed to Mailchimp:      ${report.pushedOutward}`);
  if (report.flippedEmails.length) console.log(`\n${report.dryRun ? 'Would flip' : 'Flipped'}: ${report.flippedEmails.join(', ')}`);
  if (report.mismatchOutwardEmails.length) console.log(`mismatch_outward: ${report.mismatchOutwardEmails.join(', ')}`);
  if (report.dryRun) console.log('\nRe-run with --apply to write these changes.');

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
