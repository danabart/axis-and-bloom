// Coffee presentation brief 3 (2026-10-24), decision 5 / Part C3 — after the
// story prompt follows the description's rules (decision 4), regenerate the
// story of every active coffee whose story an admin has not edited
// (story_admin_edited = false), force, through the content writer
// (routes/coffees.generateAndStoreAllContent with storyOnly, so the
// description is left alone). None where story_admin_edited is true. Per
// coffee it prints the dash count of the new text (must be 0), the guard's
// rejects and the final story; 2914 and 2917 are printed in full again at the
// end. --dry-run lists the coffees (and what each has now) and writes nothing.
//
//   npx tsx src/features/coffee_presentation/load/regenerateStories.ts --expect-db <db> [--dry-run]
//
// DATABASE_URL must be set in the shell before this runs (dotenv does not
// override it) and must name --expect-db.
import 'dotenv/config';
import { db } from '../../../db/client.js';
import { getCoffees, getHomeSlot, type CoffeeRow } from '../../../services/catalogReads.js';

type Runner = Pick<typeof db, 'query'>;

/** The coffees the run covers: active, story not admin-edited; and the ones it leaves out. */
export async function storyCandidates(runner: Runner = db): Promise<{ regenerate: CoffeeRow[]; adminEdited: CoffeeRow[] }> {
  const active = (await getCoffees({ active: true }, runner as typeof db)).sort((a, b) => a.id - b.id);
  return { regenerate: active.filter(c => !c.story_admin_edited), adminEdited: active.filter(c => c.story_admin_edited) };
}

export const dashCount = (text: string | null | undefined) => (text?.match(/[–—]/g) ?? []).length;

/** The report coffees decision 5 names; printed in full at the end. */
const REPORT_COFFEES = [2914, 2917];

async function main() {
  const args = process.argv.slice(2);
  const expectDb = args[args.indexOf('--expect-db') + 1];
  const dryRun = args.includes('--dry-run');
  if (!args.includes('--expect-db') || !expectDb) throw new Error('pass --expect-db <database name>');
  const current = (await db.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
  if (current !== expectDb) throw new Error(`connected to '${current}', expected '${expectDb}'`);
  const log = (...a: unknown[]) => console.log(`[${current}]`, ...a);

  const { regenerate, adminEdited } = await storyCandidates();
  log(`${regenerate.length} active coffees with story_admin_edited = false; ${adminEdited.length} admin-edited, left alone${adminEdited.length ? `: ${adminEdited.map(c => c.id).join(', ')}` : ''}`);
  for (const c of regenerate) {
    const home = await getHomeSlot(c.id);
    log(`  ${c.id} · ${home?.slot_name ?? '(no home slot)'} · match ${c.match_archetype ?? '-'} · story ${c.story ? `${dashCount(c.story)} dash(es) now` : 'none'}${c.story_published ? ', published' : ''}`);
  }
  if (dryRun) { log('dry run: nothing written'); return; }

  const { generateAndStoreAllContent } = await import('../../../routes/coffees.js');
  const results: Array<{ id: number; passed: boolean | null; dashes: number; attempts: number; rejects: string[]; story: string | null }> = [];
  for (const c of regenerate) {
    const out = await generateAndStoreAllContent(c.id, { force: true, storyOnly: true });
    const run = out.storyRun ?? null;
    const r = {
      id: c.id, passed: run ? run.passed : null, dashes: dashCount(run?.text ?? null),
      attempts: run?.attempts ?? 0, rejects: run?.rejects ?? [], story: out.story,
    };
    results.push(r);
    log(`\n## ${c.id} · ${run ? (run.passed ? `passed, attempt ${run.attempts}` : `FAILED after ${run.attempts} attempts, left unpublished (story_draft)`) : 'not attempted (blocked or too little data)'} · dashes ${r.dashes}`);
    for (const [i, why] of r.rejects.entries()) log(`   reject ${i + 1}: ${why}`);
    log(`   story: ${out.story ?? '(none)'}`);
  }

  log('\n# summary');
  log(`passed ${results.filter(r => r.passed).length}, failed ${results.filter(r => r.passed === false).length}, not attempted ${results.filter(r => r.passed === null).length}; guard rejects ${results.reduce((n, r) => n + r.rejects.length, 0)}; dashes in new texts ${results.reduce((n, r) => n + r.dashes, 0)}`);
  for (const id of REPORT_COFFEES) {
    const r = results.find(x => x.id === id);
    log(`\n## ${id}${r ? '' : ' (not in this run)'}`);
    if (r) log(r.story);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('load/regenerateStories.ts')) {
  main().then(() => db.end()).catch(async err => { console.error(err); await db.end(); process.exit(1); });
}
