// Unsubscribe sync — step 2 of 3 of
// backend/src/db/migrations/newsletter_unsubscribe_2026_10_01.sql: give every
// newsletter_subscriber row without one an unsubscribe_token, ahead of
// promoting the column to NOT NULL (step 3). Same shape as
// scripts/backfill-beat-respond-tokens.ts.
//
// crypto.randomBytes(32).toString('hex') per row (generateUnsubscribeToken) —
// real Node entropy, not a SQL pseudo-random expression. Idempotent: only
// touches rows where unsubscribe_token IS NULL (and re-checks that in the
// UPDATE itself, so a row that got a token from a concurrent re-subscribe is
// never overwritten). Retries a unique-index collision rather than assuming
// one can't happen.
//
// Usage (from backend/, DATABASE_URL pointed at the target database):
//   npx tsx src/scripts/backfillUnsubscribeTokens.ts              (dry run, reports only)
//   npx tsx src/scripts/backfillUnsubscribeTokens.ts --apply       (writes real tokens)
import 'dotenv/config';
import { db } from '../db/client.js';
import { generateUnsubscribeToken } from '../features/marketing/unsubscribe.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const rowsResult = await db.query<{ email: string }>(
    `SELECT email FROM newsletter_subscriber WHERE unsubscribe_token IS NULL ORDER BY created_at, email`
  );
  const rows = rowsResult.rows;

  console.log(`Mode: ${APPLY ? 'APPLY (writing to the database)' : 'DRY RUN (no writes)'}`);
  console.log(`Found ${rows.length} newsletter_subscriber row(s) with no unsubscribe_token.`);
  if (!APPLY) {
    console.log('[dry-run] Would backfill all of the above. Re-run with --apply to write.');
    await db.end();
    return;
  }

  let backfilled = 0;
  let collisionRetries = 0;

  for (const row of rows) {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const r = await db.query(
          `UPDATE newsletter_subscriber SET unsubscribe_token = $1 WHERE email = $2 AND unsubscribe_token IS NULL`,
          [generateUnsubscribeToken(), row.email],
        );
        if (r.rowCount) backfilled++;
        break;
      } catch (err: any) {
        // 23505 = unique_violation — astronomically unlikely, but retry rather than assume.
        if (err?.code === '23505' && attempt < 5) {
          collisionRetries++;
          continue;
        }
        throw err;
      }
    }
  }

  const remaining = await db.query(`SELECT COUNT(*)::int AS n FROM newsletter_subscriber WHERE unsubscribe_token IS NULL`);
  const stillNull = remaining.rows[0].n;

  console.log('---');
  console.log(`Rows backfilled: ${backfilled}`);
  if (collisionRetries > 0) console.log(`Token collisions retried: ${collisionRetries}`);
  console.log(`Rows still NULL after this run: ${stillNull}`);
  console.log(
    stillNull === 0
      ? 'Zero remaining NULLs — safe to run migration step 3 (ALTER COLUMN ... SET NOT NULL) now.'
      : 'NOT zero — do NOT run migration step 3 yet. Re-run this script (new rows may have been inserted mid-run) before proceeding.'
  );

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
