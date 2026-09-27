// Customer Blueprint C3, Part C — before routes/auth.ts's synthetic claimed
// quiz_session writer is removed, this finds any existing claimed session
// (context_data.claimedFrom = 'newsletter_subscriber') with no
// customer_identity_link pointing at it, and creates the missing link so the
// account keeps seeing the original quiz it claimed (integrity check 14).
//
// The claimed session's own context_data never stored the original profile's
// user_id directly — only quizSessionKey, copied from the newsletter_
// subscriber row at claim time. This backfill re-derives the original
// profile by joining back through newsletter_subscriber.quiz_session_key.
// A session whose quizSessionKey no longer resolves to a subscriber row (or
// resolves to a subscriber with no user_id) is reported, not linked — it
// stays a check-14 finding needing a human's judgment call.
//
// Owner-role only (refuses to run as ab_app); --dry-run by default, --apply
// explicit; writes only through customerFacts.record.identityLink.backfill().
//
// Usage:
//   npx tsx scripts/backfillClaimedSessionLinks.ts [--dry-run|--apply] [--expect-db <name>]
//
// SAFETY: refuses to run unless the connected database is named exactly
// --expect-db (default 'axisandbloom_test'). Pass --expect-db axisandbloom
// explicitly to run against production.
import 'dotenv/config';
import { ownerPool, whoAmI } from '../src/db/client.js';
import { record } from '../src/services/customerFacts.js';

const db = ownerPool();

function parseArgs(argv: string[]): { apply: boolean; expectDb: string } {
  let apply = false, dryRun = false, expectDb = 'axisandbloom_test';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--expect-db') expectDb = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error('Pass either --dry-run (default) or --apply, not both');
  return { apply, expectDb };
}

function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

interface Candidate {
  session_id: string;
  new_user_id: string;
  quiz_session_key: string | null;
  completed_at: string;
}

async function main() {
  const { apply, expectDb } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL ?? '';
  const urlDb = dbNameFromUrl(url);
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at database '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(3);
  }

  const currentUser = await whoAmI(db);
  if (currentUser === 'ab_app') {
    console.error(`REFUSING: connected as ab_app. Backfills run under the owner role.`);
    process.exit(3);
  }
  console.log(`database: ${expectDb} | connected as: ${currentUser} | mode: ${apply ? 'APPLY (writes)' : 'dry-run (writes nothing)'}`);

  const candidates = await db.query<Candidate>(
    `SELECT qs.id AS session_id, qs.user_id AS new_user_id,
            qs.context_data ->> 'quizSessionKey' AS quiz_session_key,
            qs.completed_at::text AS completed_at
     FROM quiz_session qs
     WHERE qs.context_data ->> 'claimedFrom' = 'newsletter_subscriber'
       AND NOT EXISTS (SELECT 1 FROM customer_identity_link cil WHERE cil.to_user_id = qs.user_id)`
  );

  console.log(`\nClaimed sessions without a link: ${candidates.rows.length}`);

  let linked = 0, collided = 0;
  const unresolved: string[] = [];

  for (const c of candidates.rows) {
    if (!c.quiz_session_key) { unresolved.push(`session ${c.session_id}: no quizSessionKey in context_data`); continue; }

    const subscriberResult = await db.query<{ user_id: string | null }>(
      `SELECT user_id FROM newsletter_subscriber WHERE quiz_session_key = $1`,
      [c.quiz_session_key]
    );
    const fromUserId = subscriberResult.rows[0]?.user_id ?? null;
    if (!fromUserId) { unresolved.push(`session ${c.session_id}: quizSessionKey '${c.quiz_session_key}' has no matching subscriber.user_id`); continue; }
    if (fromUserId === c.new_user_id) { unresolved.push(`session ${c.session_id}: subscriber.user_id equals the session's own user_id (nothing to link)`); continue; }

    if (apply) {
      const result = await record.identityLink.backfill({
        userId: fromUserId, source: 'backfill', sourceId: `${fromUserId}:${c.new_user_id}`,
        fromUserId, toUserId: c.new_user_id, how: 'email_match',
        occurredAt: new Date(c.completed_at),
      }, db);
      if (result.inserted) linked++; else collided++;
    } else {
      linked++;
    }
  }

  console.log(`\nlinks that would be created / created: ${linked}`);
  console.log(`links that would collide / collided: ${collided}`);
  console.log(`unresolved (not linked, needs review): ${unresolved.length}`);
  for (const u of unresolved) console.log(`  - ${u}`);

  if (apply) {
    const totalLinks = await db.query(`SELECT COUNT(*)::int AS n FROM customer_identity_link WHERE source = 'backfill'`);
    console.log(`\ncustomer_identity_link rows with source='backfill': ${totalLinks.rows[0].n}`);
  }

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
