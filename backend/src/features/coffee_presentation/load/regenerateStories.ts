// Coffee presentation brief 3 (2026-10-24), decision 5 / Part C3 — after the
// story prompt follows the description's rules (decision 4), regenerate the
// story of every active coffee whose story an admin has not edited
// (story_admin_edited = false), force, through the content writer
// (routes/coffees.generateAndStoreAllContent). None where story_admin_edited
// is true. Per coffee it prints the dash count of the new text (must be 0),
// the guard's rejects and the final story.
//
// Brief 4 (2026-10-24), decision 7 / Part D1: --fields story,description also
// regenerates the description (three_voice_story) of every active coffee, as
// brief 1 F2 did (the description has no admin-edited flag); the story still
// skips admin-edited coffees (the writer's own rule). Per coffee it then also
// prints the description, its guard outcome and how many fragments the voice
// masked. --fields defaults to story (brief 3's run). The report coffees are
// printed in full again at the end. --dry-run lists the coffees (and what each
// has now) and writes nothing.
//
//   npx tsx src/features/coffee_presentation/load/regenerateStories.ts --expect-db <db> [--fields story,description] [--dry-run]
//
// DATABASE_URL must be set in the shell before this runs (dotenv does not
// override it) and must name --expect-db.
import 'dotenv/config';
import { db } from '../../../db/client.js';
import { getCoffees, getHomeSlot, type CoffeeRow } from '../../../services/catalogReads.js';
import { getRoasterVoice } from '../../../services/roasterVoiceReads.js';

type Runner = Pick<typeof db, 'query'>;
export type Field = 'story' | 'description';

/** The coffees the run covers: active, story not admin-edited; and the ones it leaves out. */
export async function storyCandidates(runner: Runner = db): Promise<{ regenerate: CoffeeRow[]; adminEdited: CoffeeRow[] }> {
  const active = (await getCoffees({ active: true }, runner as typeof db)).sort((a, b) => a.id - b.id);
  return { regenerate: active.filter(c => !c.story_admin_edited), adminEdited: active.filter(c => c.story_admin_edited) };
}

export const dashCount = (text: string | null | undefined) => (text?.match(/[–—]/g) ?? []).length;

/** --fields parsed: a comma list of story / description, story when absent. */
export function parseFields(args: string[]): Field[] {
  const i = args.indexOf('--fields');
  if (i < 0) return ['story'];
  const fields = (args[i + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!fields.length || fields.some(f => f !== 'story' && f !== 'description')) throw new Error('--fields takes story, description or story,description');
  return [...new Set(fields)] as Field[];
}

/** The report coffees (brief 3: 2914, 2917; brief 4 decision 7 adds 2905, 2916, 2902); printed in full at the end. */
const REPORT_COFFEES = [2914, 2905, 2916, 2917, 2902];

async function main() {
  const args = process.argv.slice(2);
  const expectDb = args[args.indexOf('--expect-db') + 1];
  const dryRun = args.includes('--dry-run');
  const fields = parseFields(args);
  if (!args.includes('--expect-db') || !expectDb) throw new Error('pass --expect-db <database name>');
  const current = (await db.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
  if (current !== expectDb) throw new Error(`connected to '${current}', expected '${expectDb}'`);
  const log = (...a: unknown[]) => console.log(`[${current}]`, ...a);

  const withDescription = fields.includes('description');
  const { regenerate, adminEdited } = await storyCandidates();
  // the description covers every active coffee; the story leaves admin-edited ones alone
  const run = withDescription ? [...regenerate, ...adminEdited].sort((a, b) => a.id - b.id) : regenerate;
  log(`fields: ${fields.join(', ')}`);
  log(`${regenerate.length} active coffees with story_admin_edited = false; ${adminEdited.length} admin-edited, story left alone${adminEdited.length ? `: ${adminEdited.map(c => c.id).join(', ')}` : ''}`);
  for (const c of run) {
    const home = await getHomeSlot(c.id);
    log(`  ${c.id} · ${home?.slot_name ?? '(no home slot)'} · match ${c.match_archetype ?? '-'} · story ${c.story ? `${dashCount(c.story)} dash(es) now` : 'none'}${c.story_published ? ', published' : ''}${withDescription ? ` · description ${c.three_voice_story ? `${dashCount(c.three_voice_story)} dash(es) now` : 'none'}` : ''}`);
  }
  if (dryRun) { log('dry run: nothing written'); return; }

  const { generateAndStoreAllContent } = await import('../../../routes/coffees.js');
  const results: Array<{
    id: number; passed: boolean | null; dashes: number; attempts: number; rejects: string[]; story: string | null;
    description: string | null; descriptionReason: string | null; descriptionDashes: number; masked: number;
  }> = [];
  for (const c of run) {
    const masked = withDescription ? (await getRoasterVoice(c.id)).masked : 0;
    const out = await generateAndStoreAllContent(c.id, { force: true, fields });
    const s = out.storyRun ?? null;
    const d = out.descriptionRun ?? null;
    const r = {
      id: c.id, passed: s ? s.passed : null, dashes: dashCount(s?.text ?? null),
      attempts: s?.attempts ?? 0, rejects: s?.rejects ?? [], story: out.story,
      description: withDescription ? out.threeVoiceStory : null, descriptionReason: d?.reason ?? null,
      descriptionDashes: dashCount(d?.text ?? null), masked,
    };
    results.push(r);
    if (fields.includes('story')) {
      log(`\n## ${c.id} story · ${s ? (s.passed ? `passed, attempt ${s.attempts}` : `FAILED after ${s.attempts} attempts, left unpublished (story_draft)`) : (c.story_admin_edited ? 'admin-edited, left alone' : 'not attempted (blocked or too little data)')} · dashes ${r.dashes}`);
      for (const [i, why] of r.rejects.entries()) log(`   reject ${i + 1}: ${why}`);
      log(`   story: ${out.story ?? '(none)'}`);
    }
    if (withDescription) {
      log(`## ${c.id} description · ${d ? (d.text ? `accepted${d.leakRejects + d.styleRejects ? ` after ${d.leakRejects} leak / ${d.styleRejects} style reject(s)` : ''}` : `FAILED (${d.reason})`) : 'not attempted (blocked or no roaster material)'}${d?.text && d.reason ? ` (last reject: ${d.reason})` : ''} · dashes ${r.descriptionDashes} · masked fragments in the voice ${masked}`);
      log(`   description: ${out.threeVoiceStory ?? '(none)'}`);
    }
  }

  log('\n# summary');
  if (fields.includes('story')) {
    log(`story: passed ${results.filter(r => r.passed).length}, failed ${results.filter(r => r.passed === false).length}, not attempted ${results.filter(r => r.passed === null).length}; guard rejects ${results.reduce((n, r) => n + r.rejects.length, 0)}; dashes in new texts ${results.reduce((n, r) => n + r.dashes, 0)}`);
  }
  if (withDescription) {
    log(`description: written ${results.filter(r => r.description).length}, failed ${results.filter(r => !r.description && r.descriptionReason).length}; dashes ${results.reduce((n, r) => n + r.descriptionDashes, 0)}; coffees with masked fragments ${results.filter(r => r.masked > 0).length}`);
  }
  for (const id of REPORT_COFFEES) {
    const r = results.find(x => x.id === id);
    log(`\n## ${id}${r ? '' : ' (not in this run)'}`);
    if (r && withDescription) log(`description: ${r.description ?? '(none)'}`);
    if (r && fields.includes('story')) log(`story: ${r.story ?? '(none)'}`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('load/regenerateStories.ts')) {
  main().then(() => db.end()).catch(async err => { console.error(err); await db.end(); process.exit(1); });
}
