// Liam answer evals (2026-10-25), C4 — run the eval set once, by hand
// (trigger manual, created_by script), against the database DATABASE_URL
// points at and the live config/sommelier (read once, never written). Prints
// the pass rate, the cost and every failure with its judge note.
//   npm run liam:evals -- --expect-db axisandbloom        (production, through the proxy)
//   add --failed-in <runId> to rerun only the phrasings that failed in that run,
//   narrowed by --cases key1,key2 and/or --note-match <text> (a substring of the
//   failure's judge note); matched by case key and message.
// Same --expect-db discipline as catalogMd.ts. It spends money: Sonnet for
// every phrasing, Haiku for the gate and the judge, capped by
// evals.maxUsdPerRun and the Claude spend guard.
import 'dotenv/config';
import { db } from '../db/client.js';
import { loadSommelierConfigReadOnly } from '../services/sommelierConfig.js';
import { runEvals } from '../services/sommelierEval.js';
import { getRunResults } from '../services/sommelierReads.js';

const flag = (name: string) => { const k = process.argv.indexOf(name); return k >= 0 ? process.argv[k + 1] : undefined; };

const args = process.argv.slice(2);
const i = args.indexOf('--expect-db');
const expectDb = i >= 0 ? args[i + 1] : undefined;
const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop();
if (!expectDb || dbName !== expectDb) {
  console.error(`[liam:evals] DATABASE_URL points at '${dbName}', not '${expectDb ?? '(missing --expect-db)'}'. Refusing.`);
  process.exit(2);
}

try {
  const cfg = await loadSommelierConfigReadOnly();
  if (!cfg) throw new Error('config/sommelier is missing');
  let only: Array<{ caseKey: string; message: string }> | undefined;
  const failedIn = flag('--failed-in');
  if (failedIn) {
    const cases = flag('--cases')?.split(',').map(c => c.trim()).filter(Boolean);
    const noteMatch = flag('--note-match')?.toLowerCase();
    only = (await getRunResults(Number(failedIn)))
      .filter(r => !r.passed && (!cases || cases.includes(r.case_key)) && (!noteMatch || (r.judge_notes ?? '').toLowerCase().includes(noteMatch)))
      .map(r => ({ caseKey: r.case_key, message: r.message }));
    console.log(`[liam:evals] rerunning ${only.length} phrasing(s) that failed in run ${failedIn}`);
    if (!only.length) throw new Error('nothing to rerun');
  }
  const summary = await runEvals({ trigger: 'manual', createdBy: 'script', only });
  const results = await getRunResults(summary.runId);
  const rate = summary.phrasings ? ((summary.passed / summary.phrasings) * 100).toFixed(1) : '—';
  console.log(`\nrun ${summary.runId}: ${summary.passed}/${summary.phrasings} passed (${rate}%), ${summary.failed} failed, ${summary.skipped} skipped, $${(summary.usdMicros / 1_000_000).toFixed(4)}${summary.note ? `; ${summary.note}` : ''}`);
  const byRoute = results.reduce<Record<string, number>>((m, r) => { m[r.route] = (m[r.route] ?? 0) + 1; return m; }, {});
  console.log(`routes: ${Object.entries(byRoute).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const r of results.filter(x => !x.passed)) {
    console.log(`\nFAIL [${r.case_key}] (${r.route}) "${r.message}"\n  ${r.judge_notes ?? '(no note)'}\n  reply: ${r.reply.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
} catch (err) {
  console.error('[liam:evals] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
  process.exit(process.exitCode ?? 0);
}
