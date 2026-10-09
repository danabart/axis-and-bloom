// Seed + backfill quiz_session_interpretation (SCD Type 2). Quiz interpretation v2.1, brief 2, Part C;
// the v2.2 pass is Prompt 4B, Part E (2026-10-09).
//
//   DATABASE_URL=<url> NODE_ENV=development npx tsx scripts/backfillQuizInterpretation.ts \
//       [--dry-run | --apply] [--limit N] [--expect-db <name>] [--report <path.csv>]
//
// Writes quiz_session_interpretation only: a session whose current row is v2.1 gets that row closed
// (valid_to, is_current — quizSession.closeCurrentInterpretation, nothing else) and a v2.2 row inserted as current,
// in one transaction; a session with no row yet gets the brief-2 seed. Read-only against everything else; a data
// guard (count + md5 of quiz_session and newsletter_subscriber, and the count of non-v2.2 interpretation rows)
// is checked inside every write transaction and aborts it on any difference. Idempotent: a second run finds
// nothing. --report writes a before/after CSV, one row per re-interpreted session (works with --dry-run).
//
// SAFETY: it refuses to run unless the database it is connected to is named exactly --expect-db (default
// 'axisandbloom_test'). The name is checked from DATABASE_URL BEFORE connecting, and again from
// current_database() after. --dry-run is the default and writes nothing. Dana runs --apply on prod herself:
//   ... --expect-db axisandbloom --dry-run   (check the 37 crawl rows match the fixture)
//   ... --expect-db axisandbloom --apply
// DATABASE_URL must be set in the shell before launching (db/client.ts reads it at import time; dotenv never
// overrides a variable that is already set).
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownerPool, whoAmI } from '../src/db/client.js';
import { INTERPRETATION_VERSION } from '../src/services/quizScoring.js';
import {
  runBackfill, compareToFixture, parseArgs, dbNameFromUrl, buildReportRows, toCsv, SUPERSEDED_VERSION,
} from '../src/services/quizInterpretationBackfill.js';

// Customer Blueprint · brief C1, Part B (2026-09-27) — backfills write facts
// (quiz_session_interpretation), so this script now runs through
// ownerPool(), not the shared `db` pool, and refuses outright if that somehow
// still resolves to ab_app (which cannot write quiz_session_interpretation
// past a single is_current row, and must never run backfills anyway).
const db = ownerPool();

async function main() {
  const { apply, limit, expectDb, report: reportPath } = parseArgs(process.argv.slice(2));

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
    const currentUser = await whoAmI(db);
    if (currentUser === 'ab_app') {
      console.error(`REFUSING: connected as ab_app. Backfills run under the owner role — set OWNER_DATABASE_URL or point DATABASE_URL at the owner connection string.`);
      process.exit(3);
    }
    const tbl = await client.query(`SELECT to_regclass('public.quiz_session_interpretation') IS NOT NULL AS ok`);
    if (!tbl.rows[0].ok) {
      console.error('quiz_session_interpretation does not exist in this database. Deploy the DDL first (schema.sql applies on backend boot).');
      process.exit(4);
    }

    const V = INTERPRETATION_VERSION;
    console.log(`database: ${cur} | role: ${currentUser} | mode: ${apply ? 'APPLY (writes)' : 'dry-run (writes nothing)'} | ruleset: ${V}${limit ? ` | limit ${limit}` : ''}`);
    const report = await runBackfill(client, { apply, limit });

    console.log(`quiz_session rows: ${report.sessionsTotal} (left alone: ${report.sessionsAlreadyCurrent}, to process: ${report.sessionsProcessed})`);
    console.log(`  current row ${SUPERSEDED_VERSION} -> ${V}: ${report.reinterpret} session(s); no row yet (seed): ${report.seeded}`);
    console.log(`  with answerIds: ${report.withAnswerIds}`);
    console.log(`  ${SUPERSEDED_VERSION} rows ${apply ? 'closed' : 'would close'}: ${report.closedRows}`);
    console.log(`  ${V} rows ${apply ? 'inserted' : 'would insert'}: ${report.v2Rows}`);
    console.log(`  v1 seed rows ${apply ? 'inserted' : 'would insert'}: ${report.v1Rows}`);
    console.log(`  not re-interpretable: ${report.v1OnlyCurrent} seeded v1-only, skip reasons ${JSON.stringify(report.skipReasons)}`);
    const g = report.guard!;
    console.log(`guard before: quiz_session ${g.before.quizSession}, newsletter_subscriber ${g.before.newsletterSubscriber}, rows other than ${V}: ${g.before.nonCurrentRulesetRows}`);
    console.log(`guard after:  quiz_session ${g.after.quizSession}, newsletter_subscriber ${g.after.newsletterSubscriber}, rows other than ${V}: ${g.after.nonCurrentRulesetRows}`);

    const fixture = JSON.parse(readFileSync(
      fileURLToPath(new URL('../src/fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json', import.meta.url)), 'utf8'));
    const cmp = compareToFixture(report.plans, fixture);
    const matched = cmp.filter(c => c.agree === true).length;
    const differ = cmp.filter(c => c.agree === false);
    const missing = cmp.filter(c => c.agree === null);
    console.log(`crawl fixture (${cmp.length} cases): ${matched} match expected_v2_2, ${differ.length} differ, ${missing.length} not present in this database`);
    for (const c of differ) console.log(`  DIFF ${c.caseId}: ${c.detail}`);

    if (reportPath) {
      const rows = await buildReportRows(client, report.plans);
      const out = resolve(reportPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, toCsv(rows));
      const changed = rows.filter(r => r.changed);
      const asked = rows.filter(r => r.explore_thread_already_asked);
      console.log(`report: ${out} (${rows.length} rows, ${changed.length} changed, ${asked.length} with explore_thread_already_asked)`);
    }
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
