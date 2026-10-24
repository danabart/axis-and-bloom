// Coffee presentation brief 2 (2026-10-24), decision 7 / Part C — Quieta Non
// Movere (Fabricator, coffee 2917): match archetype → chocolate_nutty, the
// decision Dana made on 2026-10-21 after the Balance cupping (only the
// placement happened then). Through the assignment door
// (catalogService.setMatchArchetype), never inline SQL: source 'cupping', the
// session of 2026-10-21 (looked up by date, never a literal id), confidence
// medium, Dana's note, and the basis composeBasis composes from the current
// evidence (evidenceReads.getBasisRows, the rows the workbench's archetype
// card reads), finalized with Dana's note as its rule. The roaster's
// proposed archetype (Balanced, on the portal form) stays the evidence it is.
// After the write: the coffee's description is regenerated
// (generateAndStoreAllContent force, the story fields only since brief 2) so
// the text follows the new signature line, then the public flavor-wheel line
// and story dial position are printed and the line asserted.
//
//   npx tsx src/features/coffee_presentation/load/setMatch2917.ts --expect-db <db> [--dry-run]
//
// DATABASE_URL must be set in the shell before this runs (dotenv does not
// override it) and must name --expect-db. Skips when the current match already
// is chocolate_nutty, so a second run writes nothing.
import 'dotenv/config';
import { db } from '../../../db/client.js';
import { getBasisRows } from '../../../services/evidenceReads.js';
import { listSessions } from '../../../services/cuppingReads.js';
import { composeBasis, finalizeBasis, ruleRequired, type BasisInput } from '../../../services/evidenceBasis.js';
import type { SetMatchArchetypeInput } from '../../../services/catalogService.js';

type Runner = Pick<typeof db, 'query'>;

export const COFFEE_ID = 2917;
export const TARGET = 'chocolate_nutty';
export const SESSION_DATE = '2026-10-21';
export const CONFIDENCE = 'medium';
export const NOTES = 'Dana 2026-10-21: C&N light, slot 1; bitterness and a grippy texture, not body. Supersedes our Fruity match from s37 (2026-09-30). Roaster form proposes Balanced, kept as evidence.';
const ACTOR = 'coffee presentation brief 2';
// What the public flavor-wheel line should read once the match is chocolate_nutty (the brief's expectation).
const EXPECTED_LINE = 'Hazelnut / a hint of fruity: citrus fruit; a hint of spices: cinnamon';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export interface MatchPlan {
  coffeeId: number;
  current: { archetype: string | null; confidence: string | null; source: string | null; sessionId: number | null };
  skip: boolean;
  session: { id: number; date: string };
  input: SetMatchArchetypeInput;
  basisText: string;
  ruleRequired: boolean;
  homeSlot: { slotId: number; archetype: string; sortOrder: number } | null;
}

/** Everything the run would write, read on `runner`; writes nothing. */
export async function planMatch(runner: Runner, p: { coffeeId: number; archetype: string; confidence: string; sessionDate: string; notes: string }): Promise<MatchPlan> {
  const cur = (await runner.query(
    `SELECT match_archetype, match_confidence, match_source, match_session_id FROM v_coffee WHERE id = $1`, [p.coffeeId])).rows[0];
  if (!cur) throw new Error(`coffee ${p.coffeeId} not found`);
  // by date through the cupping read door (lint:cupping); pg hands a DATE back as local midnight
  const day = (d: unknown) => d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
  const sessions = (await listSessions(runner as typeof db)).filter((s: { session_date: unknown }) => day(s.session_date) === p.sessionDate);
  if (sessions.length !== 1) throw new Error(`expected one cupping session dated ${p.sessionDate}, found ${sessions.length}`);
  const session = { id: sessions[0].id, date: p.sessionDate };

  const rows = await getBasisRows(p.coffeeId, runner);
  const a = rows.archetype ?? {};
  const basisInput: BasisInput = {
    archetype: {
      assigned_from_session_id: num(a.assigned_from_session_id), latest_session_id: num(a.latest_session_id),
      is_blind: (a.is_blind as boolean | null) ?? null, roaster_present: (a.roaster_present as boolean | null) ?? null,
      roaster_form_proposal: (a.roaster_form_proposal as string | null) ?? null,
      roaster_remark_proposals: (a.roaster_remark_proposals as string[] | null) ?? null,
    },
    calls: rows.calls.map(c => ({ cupper_id: Number(c.cupper_id), cupper_name: String(c.cupper_name), session_id: num(c.session_id), archetype_call: (c.archetype_call as string | null) ?? null })),
    sessionId: session.id,
    roasterForm: rows.roasterResponse ? { version: num(rows.roasterResponse.version), respondent: rows.roasterResponse.respondent_name } : null,
    website: rows.websiteDescriptors.map(w => String(w.remark)),
    placement: null,
  };
  const composed = composeBasis(basisInput);
  const final = finalizeBasis(composed, p.notes);

  const home = (await runner.query<{ slot_id: number; archetype: string; sort_order: number }>(
    `SELECT cds.id AS slot_id, cds.archetype, cds.sort_order FROM coffee_slot_assignment csa JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
      WHERE csa.coffee_id = $1 AND csa.role = 'home' AND csa.is_active`, [p.coffeeId])).rows[0];

  return {
    coffeeId: p.coffeeId,
    current: { archetype: cur.match_archetype, confidence: cur.match_confidence, source: cur.match_source, sessionId: cur.match_session_id },
    skip: cur.match_archetype === p.archetype,
    session,
    input: {
      coffeeId: p.coffeeId, archetype: p.archetype as SetMatchArchetypeInput['archetype'], confidence: p.confidence as SetMatchArchetypeInput['confidence'],
      source: 'cupping', sessionId: session.id, notes: p.notes, basis: final.json as unknown as Record<string, unknown>,
    },
    basisText: composed.text,
    ruleRequired: ruleRequired(basisInput, p.archetype),
    homeSlot: home ? { slotId: home.slot_id, archetype: home.archetype, sortOrder: home.sort_order } : null,
  };
}

export interface RunDeps {
  runner: Runner;
  setMatch: (input: SetMatchArchetypeInput) => Promise<{ warnings: unknown[] }>;
  regenerate: (coffeeId: number) => Promise<unknown>;
  log: (...args: unknown[]) => void;
}

/** Plan, then (unless dry run or skipped) one setMatch and one regeneration. */
export async function runMatch(p: Parameters<typeof planMatch>[1] & { dryRun: boolean }, deps: RunDeps): Promise<{ plan: MatchPlan; wrote: boolean }> {
  const plan = await planMatch(deps.runner, p);
  deps.log('current assignment:', plan.current);
  deps.log(`session for ${plan.session.date}: s${plan.session.id}`);
  deps.log('basis (composeBasis):', plan.basisText);
  deps.log('rule required:', plan.ruleRequired, '| rule stored:', p.notes);
  deps.log('input:', { ...plan.input, basis: '(json below)' });
  deps.log('basis json:', JSON.stringify(plan.input.basis));
  if (plan.skip) { deps.log(`current match already is ${p.archetype}; nothing written`); return { plan, wrote: false }; }
  if (p.dryRun) return { plan, wrote: false };
  const result = await deps.setMatch(plan.input);
  deps.log('setMatchArchetype warnings:', JSON.stringify(result.warnings));
  await deps.regenerate(p.coffeeId);
  return { plan, wrote: true };
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
  // The page's line, as frontend/src/app/lib/signatureLine.ts draws it (the
  // backend build cannot import frontend files): signature notes, then one
  // "a hint of <family>: <notes>" clause per accent family.
  const signatureText = (rs: Array<{ descriptor: string; is_signature: boolean }>) => rs.filter(r => r.is_signature).map(r => r.descriptor).join(', ');
  const accentClauses = (rs: Array<{ descriptor: string; family: string | null; is_signature: boolean }>) => {
    const groups: Array<{ family: string; notes: string[] }> = [];
    for (const r of rs.filter(x => !x.is_signature)) {
      const family = (r.family ?? '').toLowerCase();
      const g = groups.find(x => x.family === family);
      if (g) g.notes.push(r.descriptor.toLowerCase()); else groups.push({ family, notes: [r.descriptor.toLowerCase()] });
    }
    return groups.map(g => `a hint of ${g.family}: ${g.notes.join(', ')}`);
  };

  const params = { coffeeId: COFFEE_ID, archetype: TARGET, confidence: CONFIDENCE, sessionDate: SESSION_DATE, notes: NOTES, dryRun };
  const plan = await planMatch(db, params);
  if (plan.homeSlot) {
    const preview = await previewPlacement({ coffeeId: COFFEE_ID, slotId: plan.homeSlot.slotId, role: 'home' });
    log(`previewPlacement (home slot ${plan.homeSlot.slotId}, ${plan.homeSlot.archetype} #${plan.homeSlot.sortOrder}) warnings:`, JSON.stringify(preview.warnings));
  } else {
    log('no active home slot: previewPlacement has no slot to preview');
  }

  const { wrote } = await runMatch(params, {
    runner: db,
    setMatch: async input => setMatchArchetype(input, { actor: ACTOR }),
    regenerate: async id => {
      const content = await generateAndStoreAllContent(id, { force: true });
      log('regenerated three_voice_story:', content.threeVoiceStory);
    },
    log,
  });
  if (dryRun) { log('dry run: nothing written'); return; }

  const rows = await getCustomerDescriptors(COFFEE_ID);
  const clauses = accentClauses(rows);
  const line = `${signatureText(rows)}${clauses.length ? ' / ' + clauses.join('; ') : ''}`;
  log(`/flavor-wheel line: ${line}`);
  log(line === EXPECTED_LINE ? 'line matches the brief (PASS)' : `line differs from the brief's "${EXPECTED_LINE}" (CHECK)`);
  const coffee = await getCoffee(COFFEE_ID);
  const home = await getHomeSlot(COFFEE_ID);
  const dialPosition = home && home.placement_archetype === coffee?.match_archetype ? { label: home.position_label, sortOrder: home.sort_order } : null;
  log('/story dialPosition:', JSON.stringify(dialPosition), wrote ? '' : '(no write this run)');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('load/setMatch2917.ts')) {
  main().then(() => db.end()).catch(async err => { console.error(err); await db.end(); process.exit(1); });
}
