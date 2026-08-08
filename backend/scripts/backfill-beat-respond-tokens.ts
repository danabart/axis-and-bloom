// One-time script (H3/C4 security fix): populate beat_event.respond_token
// for every existing row, ahead of promoting the column to NOT NULL — see
// backend/src/db/migrations/beat_event_respond_token_2026_08_09.sql (step 2
// of 3) for the full ordered migration this belongs to.
//
// Uses crypto.randomBytes(32).toString('hex') per row — real Node entropy,
// matching household_invitation.token's own generation (routes/household.ts)
// and coffees.qr_token's (services/qrDoor.ts) — not a SQL pseudo-random
// expression, since this database has no pgcrypto extension enabled and the
// task's own spec calls for crypto.randomBytes specifically.
//
// Idempotent: only touches rows where respond_token IS NULL, so a second
// run (e.g. if new beat_events land between this script and the migration's
// step 3) is always safe and just backfills whatever's still missing.
// Retries on the vanishingly unlikely event of a 32-byte collision against
// the UNIQUE index (step 1 of the migration) rather than assuming one can't
// happen.
//
// Usage:
//   npx tsx scripts/backfill-beat-respond-tokens.ts              (dry run, reports only)
//   npx tsx scripts/backfill-beat-respond-tokens.ts --apply       (writes real tokens)
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { db } from '../src/db/client.js';

const APPLY = process.argv.includes('--apply');

function generateRespondToken(): string {
  return randomBytes(32).toString('hex');
}

async function main() {
  const rowsResult = await db.query<{ id: number }>(
    `SELECT id FROM beat_event WHERE respond_token IS NULL ORDER BY id`
  );
  const rows = rowsResult.rows;

  console.log(`Found ${rows.length} beat_event row(s) with no respond_token.`);
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
      const token = generateRespondToken();
      try {
        await db.query(`UPDATE beat_event SET respond_token = $1 WHERE id = $2`, [token, row.id]);
        break;
      } catch (err: any) {
        // 23505 = unique_violation — a real collision on a 32-byte random
        // value is astronomically unlikely, but retry rather than assume.
        if (err?.code === '23505' && attempt < 5) {
          collisionRetries++;
          continue;
        }
        throw err;
      }
    }
    backfilled++;
  }

  const remaining = await db.query(`SELECT COUNT(*)::int AS n FROM beat_event WHERE respond_token IS NULL`);
  const stillNull = remaining.rows[0].n;

  console.log('---');
  console.log(`Mode: APPLY (wrote to Cloud SQL)`);
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
