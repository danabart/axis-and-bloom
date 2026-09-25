// Seed + backfill quiz_session_interpretation (SCD Type 2). Quiz interpretation v2.1, brief 2, Part C.
//
//   DATABASE_URL=<url> NODE_ENV=development npx tsx scripts/backfillQuizInterpretation.ts \
//       [--dry-run | --apply] [--limit N] [--expect-db <name>]
//
// INSERT-only against quiz_session_interpretation; read-only against everything else (quiz_session,
// coffee_archetype, quiz_answer*). Never updates, deletes or alters quiz_session, newsletter_subscriber or any
// Firestore document. Idempotent: sessions that already have any interpretation row are not touched, and every
// insert is ON CONFLICT (quiz_session_id, interpretation_version) DO NOTHING.
//
// SAFETY: it refuses to run unless the database it is connected to is named exactly --expect-db (default
// 'axisandbloom_test'). The name is checked from DATABASE_URL BEFORE connecting, and again from
// current_database() after. --dry-run is the default and writes nothing. Dana runs --apply on prod herself:
//   ... --expect-db axisandbloom --dry-run   (check the 37 crawl rows match the fixture)
//   ... --expect-db axisandbloom --apply
// DATABASE_URL must be set in the shell before launching (db/client.ts reads it at import time; dotenv never
// overrides a variable that is already set).
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db } from '../src/db/client.js';
import { INTERPRETATION_VERSION } from '../src/services/quizScoring.js';
import { runBackfill, compareToFixture, parseArgs, dbNameFromUrl } from '../src/services/quizInterpretationBackfill.js';

async function main() {
  const { apply, limit, expectDb } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL ?? '';
  const urlDb = dbNameFromUrl(url);
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at database '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to. ` +
      `Set DATABASE_URL to the right database or pass --expect-db explicitly.`);
    process.exit(3);
  }

  const client = await db.connect();
  try {
    const cur = (await client.query('SELECT current_database() AS d')).rows[0].d;
    if (cur !== expectDb) {
      console.error(`REFUSING: connected to '${cur}', expected '${expectDb}'. Nothing was written.`);
      process.exit(3);
    }
    const tbl = await client.query(`SELECT to_regclass('public.quiz_session_interpretation') IS NOT NULL AS ok`);
    if (!tbl.rows[0].ok) {
      console.error('quiz_session_interpretation does not exist in this database. Deploy the DDL first (schema.sql applies on backend boot).');
      process.exit(4);
    }

    console.log(`database: ${cur} | mode: ${apply ? 'APPLY (writes)' : 'dry-run (writes nothing)'} | ruleset: ${INTERPRETATION_VERSION}${limit ? ` | limit ${limit}` : ''}`);
    const report = await runBackfill(client, { apply, limit });

    console.log(`quiz_session rows: ${report.sessionsTotal} (already interpreted: ${report.sessionsAlreadyInterpreted}, to process: ${report.sessionsProcessed})`);
    console.log(`  with answerIds: ${report.withAnswerIds}`);
    console.log(`  v1  rows ${apply ? 'inserted' : 'would insert'}: ${report.v1Rows}`);
    console.log(`  v2.1 rows ${apply ? 'inserted' : 'would insert'}: ${report.v2Rows}`);
    console.log(`  sessions keeping v1 as current (no v2.1 possible): ${report.v1OnlyCurrent} ${JSON.stringify(report.skipReasons)}`);

    const fixture = JSON.parse(readFileSync(
      fileURLToPath(new URL('../src/fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json', import.meta.url)), 'utf8'));
    const cmp = compareToFixture(report.plans, fixture);
    const matched = cmp.filter(c => c.agree === true).length;
    const differ = cmp.filter(c => c.agree === false);
    const missing = cmp.filter(c => c.agree === null);
    console.log(`crawl fixture (${cmp.length} cases): ${matched} match expected_v2_1, ${differ.length} differ, ${missing.length} not present in this database`);
    for (const c of differ) console.log(`  DIFF ${c.caseId}: ${c.detail}`);
    if (!apply) console.log('dry-run: nothing written. Re-run with --apply to write.');
  } finally {
    client.release();
    await db.end();
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
