// Liam L3, Part E — read-only export of v_customer_calibration to CSV. ab_app
// is fine (no writes). Output feeds quizRecalibrate.ts unchanged (that script
// looks up columns by name via header.indexOf, so extra columns here are
// simply ignored by it) and, with --with-outcomes, prints the
// recommended-vs-ordered numbers straight from the query.
//
//   npx tsx scripts/exportCalibration.ts --set-name=<name> [--with-outcomes]
//
// Writes backend/tmp/<name>.csv (gitignored — see backend/.gitignore).
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db/client.js';

function parseArgs(argv: string[]): { setName: string; withOutcomes: boolean } {
  let setName = 'recalibration';
  const withOutcomes = argv.includes('--with-outcomes');
  for (const arg of argv) {
    if (arg.startsWith('--set-name=')) setName = arg.slice('--set-name='.length);
  }
  const setNameIdx = argv.indexOf('--set-name');
  if (setNameIdx !== -1 && argv[setNameIdx + 1]) setName = argv[setNameIdx + 1];
  return { setName, withOutcomes };
}

// RFC 4180: quote every field, double any embedded quote — the exact
// escaping quizRecalibrate.ts's own parseCsv() expects on the way back in.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const { setName, withOutcomes } = parseArgs(process.argv.slice(2));

  const result = await db.query(`SELECT * FROM v_customer_calibration ORDER BY quiz_completed_at ASC NULLS LAST`);
  const rows = result.rows;
  if (!rows.length) {
    console.log('v_customer_calibration returned 0 rows — nothing to export.');
    return;
  }

  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => csvField(row[c])).join(','));
  }

  const outDir = resolve(import.meta.dirname, '..', 'tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${setName}.csv`);
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${rows.length} rows to ${outPath}`);

  if (withOutcomes) {
    const withRec = rows.filter(r => r.first_recommendation_coffee !== null);
    const followed = withRec.filter(r => r.first_attributed_order_coffee !== null);
    const markedCount = withRec.filter(r => r.first_recommendation_detected === false).length;
    const detectedCount = withRec.filter(r => r.first_recommendation_detected === true).length;
    console.log('\n--with-outcomes:');
    console.log(`  quiz-takers: ${rows.length}`);
    console.log(`  with a first recommendation: ${withRec.length} (marked ${markedCount}, detected ${detectedCount})`);
    console.log(`  recommended → later ordered: ${followed.length}${withRec.length ? ` (${Math.round((followed.length / withRec.length) * 1000) / 10}%)` : ''}`);
    const threadCounts = rows.reduce((acc: Record<string, number>, r) => {
      acc[r.thread_status] = (acc[r.thread_status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`  threads — none: ${threadCounts.none ?? 0}, asked: ${threadCounts.asked ?? 0}, answered: ${threadCounts.answered ?? 0}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
