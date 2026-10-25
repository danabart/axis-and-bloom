// Coffee presentation brief 4 (2026-10-24), decision 5 / Part C — Blossom
// (coffee 2916): match archetype → chocolate_nutty, so the match agrees with
// its slot (C&N #3 "Richer") and its card has a signature group again. Through
// the assignment door (catalogService.setMatchArchetype), never inline SQL,
// with brief 2's plan and run (setMatch2917.planMatch / runMatch): source
// 'cupping', the session dated 2026-10-23 (looked up by date, never a literal
// id), Dana's note, and the basis composeBasis composes from the current
// evidence. The confidence is read, not assumed: 'high' when every cupper row
// of that session calls chocolate_nutty (and there are at least two), else
// 'medium'. The roaster's form proposal stays the evidence it is.
// After the write: the coffee's texts are regenerated (generateAndStoreAllContent
// force, as admin refresh-content does), then the public flavor-wheel line,
// the card teaser and tags (GET /:id/content) and the /story dial position are
// printed. Before and after the assignment row are printed too.
//
//   npx tsx src/features/coffee_presentation/load/setMatch2916.ts --expect-db <db> [--dry-run]
//
// DATABASE_URL must be set in the shell before this runs (dotenv does not
// override it) and must name --expect-db. Skips when the current match already
// is chocolate_nutty, so a second run writes nothing.
import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '../../../db/client.js';
import { getBasisRows } from '../../../services/evidenceReads.js';
import { listSessions } from '../../../services/cuppingReads.js';
import { runMatch } from './setMatch2917.js';

type Runner = Pick<typeof db, 'query'>;

export const COFFEE_ID = 2916;
export const TARGET = 'chocolate_nutty';
export const SESSION_DATE = '2026-10-23';
// Dana's go (2026-10-24): the note says what the 2026-10-23 rows hold (Camila made no call).
export const NOTES = 'Dana 2026-10-24: Blossom is Chocolate & Nutty, slot 3 Richer. Dana called C&N dark on 2026-10-23; Camila ticked Nutty / Cocoa with no call. Roaster form proposal kept as evidence.';
const ACTOR = 'coffee presentation brief 4';

// pg hands a DATE back as local midnight
const day = (d: unknown) => d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10);

/** 'high' when every cupper row of the session dated `sessionDate` calls `archetype` (two rows at least), else 'medium'; with the calls read. */
export async function sessionConfidence(runner: Runner, coffeeId: number, archetype: string, sessionDate: string):
  Promise<{ confidence: 'high' | 'medium'; sessionId: number; calls: Array<{ cupper: string; call: string | null }> }> {
  const sessions = (await listSessions(runner as typeof db)).filter((s: { session_date: unknown }) => day(s.session_date) === sessionDate);
  if (sessions.length !== 1) throw new Error(`expected one cupping session dated ${sessionDate}, found ${sessions.length}`);
  const sessionId = Number(sessions[0].id);
  const rows = await getBasisRows(coffeeId, runner);
  const calls = rows.calls
    .filter(c => Number(c.session_id) === sessionId)
    .map(c => ({ cupper: String(c.cupper_name), call: (c.archetype_call as string | null) ?? null }));
  const confidence = calls.length >= 2 && calls.every(c => c.call === archetype) ? 'high' : 'medium';
  return { confidence, sessionId, calls };
}

/** The current and superseded assignment rows of the coffee, newest first (the before/after print). */
async function assignmentRows(runner: Runner, coffeeId: number) {
  return (await runner.query(
    `SELECT id, archetype, confidence, source, assigned_from_session_id, superseded_at, created_at, notes
       FROM coffee_archetype_assignment WHERE coffee_id = $1 ORDER BY created_at DESC, id DESC`, [coffeeId])).rows;
}

async function main() {
  const args = process.argv.slice(2);
  const expectDb = args[args.indexOf('--expect-db') + 1];
  const dryRun = args.includes('--dry-run');
  if (!args.includes('--expect-db') || !expectDb) throw new Error('pass --expect-db <database name>');
  const current = (await db.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
  if (current !== expectDb) throw new Error(`connected to '${current}', expected '${expectDb}'`);
  const log = (...a: unknown[]) => console.log(`[${current}]`, ...a);

  const { setMatchArchetype, previewPlacement } = await import('../../../services/catalogService.js');
  const { generateAndStoreAllContent } = await import('../../../routes/coffees.js');
  const { getCustomerDescriptors } = await import('../../../services/cuppingReads.js');
  const { getCoffee, getHomeSlot } = await import('../../../services/catalogReads.js');
  const { getCardTags } = await import('../../../services/roasterVoiceReads.js');
  // The page's line and teaser, as frontend/src/app/lib/signatureLine.ts draws
  // them, loaded by a path built at run time (the backend build never compiles it).
  const line = await import(pathToFileURL(path.resolve(process.cwd(), '..', 'frontend', 'src', 'app', 'lib', 'signatureLine.ts')).href);

  log('assignment rows before:', JSON.stringify(await assignmentRows(db, COFFEE_ID), null, 1));
  const conf = await sessionConfidence(db, COFFEE_ID, TARGET, SESSION_DATE);
  log(`calls in s${conf.sessionId} (${SESSION_DATE}):`, JSON.stringify(conf.calls), `→ confidence ${conf.confidence}`);

  const home = await getHomeSlot(COFFEE_ID);
  if (home) {
    const preview = await previewPlacement({ coffeeId: COFFEE_ID, slotId: home.slot_id, role: 'home' });
    log(`previewPlacement (home slot ${home.slot_id}, ${home.placement_archetype} #${home.sort_order} ${home.position_label}) warnings:`, JSON.stringify(preview.warnings));
  }

  const params = { coffeeId: COFFEE_ID, archetype: TARGET, confidence: conf.confidence, sessionDate: SESSION_DATE, notes: NOTES, dryRun };
  const { wrote } = await runMatch(params, {
    runner: db,
    setMatch: async input => setMatchArchetype(input, { actor: ACTOR }),
    regenerate: async id => {
      const content = await generateAndStoreAllContent(id, { force: true });
      log('regenerated three_voice_story:', content.threeVoiceStory);
      log('regenerated story:', content.story, content.storyRun ? `(${content.storyRun.passed ? 'passed' : 'FAILED'}, ${content.storyRun.attempts} attempt(s))` : '');
    },
    log,
  });
  if (dryRun) { log('dry run: nothing written'); return; }

  log('assignment rows after:', JSON.stringify(await assignmentRows(db, COFFEE_ID), null, 1));
  const rows = await getCustomerDescriptors(COFFEE_ID);
  const clauses: string[] = line.accentClauses(rows);
  log(`/flavor-wheel line: ${line.signatureText(rows)}${clauses.length ? ' / ' + clauses.join('; ') : ''}`);
  log(`/content teaser: ${line.teaserFor(rows)}`);
  log('/content tags:', JSON.stringify(await getCardTags(COFFEE_ID)));
  const coffee = await getCoffee(COFFEE_ID);
  const after = await getHomeSlot(COFFEE_ID);
  const dialPosition = after && after.placement_archetype === coffee?.match_archetype ? { label: after.position_label, sortOrder: after.sort_order } : null;
  log('/story dialPosition:', JSON.stringify(dialPosition), wrote ? '' : '(no write this run)');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('load/setMatch2916.ts')) {
  main().then(() => db.end()).catch(async err => { console.error(err); await db.end(); process.exit(1); });
}
