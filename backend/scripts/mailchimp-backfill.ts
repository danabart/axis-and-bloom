// Step 05 (C1): backfill existing newsletter_subscriber rows into Mailchimp with the
// ARCHETYPE merge field + tags (source/archetype/quiz-completed/experimental) that the
// live sync (backend/src/features/marketing/mailchimp.ts) now sets on every new signup.
//
// Idempotent: syncMailchimpMember is a PUT-by-hash upsert + tag POST — re-running is safe.
// Rate-limited: Mailchimp allows ~10 concurrent requests, so members are synced in
// batches of 10 rather than all at once.
//
// Usage (run from backend/, with DATABASE_URL/MAILCHIMP_API_KEY/MAILCHIMP_LIST_ID set —
// see axis_and_bloom_local_cloudsql_testing memory for the Cloud SQL Auth Proxy playbook):
//   npx tsx scripts/mailchimp-backfill.ts              (dry run, lists subscribers only)
//   npx tsx scripts/mailchimp-backfill.ts --apply       (writes to Mailchimp)
import 'dotenv/config';
import { db } from '../src/db/client.js';
import { MC_ENABLED, syncMailchimpMember } from '../src/features/marketing/mailchimp.js';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 10;

interface SubscriberRow {
  email: string;
  first_name: string | null;
  source_name: string | null;
  archetype: string | null;
  experimental: boolean | null;
}

async function main() {
  if (!MC_ENABLED) {
    console.error('MAILCHIMP_API_KEY / MAILCHIMP_LIST_ID not set — nothing to do.');
    process.exit(1);
  }

  const result = await db.query<SubscriberRow>(
    `SELECT ns.email, ns.first_name, ss.name AS source_name, ns.archetype, ns.experimental
     FROM newsletter_subscriber ns
     LEFT JOIN subscriber_source ss ON ss.id = ns.source_id
     WHERE ns.subscribed = TRUE
     ORDER BY ns.created_at ASC`,
  );
  const rows = result.rows;

  console.log(`Mode: ${APPLY ? 'APPLY (writing to Mailchimp)' : 'DRY RUN (no writes)'}`);
  console.log(`Subscribers found: ${rows.length}`);

  let synced = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${i / BATCH_SIZE + 1}: ${batch.map(r => r.email).join(', ')}`);
    if (!APPLY) continue;

    const outcomes = await Promise.allSettled(
      batch.map(row =>
        syncMailchimpMember(row.email, row.first_name ?? '', {
          source: row.source_name,
          archetype: row.archetype,
          experimental: row.experimental,
        }),
      ),
    );
    for (const [idx, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled' && outcome.value) {
        synced++;
      } else {
        failed++;
        const reason = outcome.status === 'rejected' ? outcome.reason : 'see [mailchimp] log above';
        console.error(`  failed: ${batch[idx].email} —`, reason);
      }
    }
  }

  console.log('---');
  console.log(`Mode: ${APPLY ? 'APPLY (wrote to Mailchimp)' : 'DRY RUN (no writes)'}`);
  console.log(`Subscribers scanned: ${rows.length}`);
  if (APPLY) {
    console.log(`Synced: ${synced}`);
    console.log(`Failed: ${failed}`);
  } else {
    console.log('Re-run with --apply to write these changes.');
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
