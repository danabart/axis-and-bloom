// Ella's Bloom Map 9 (2026-11-20): Brazil moves from Chocolate & Nutty to
// Balanced. One coffee, three decisions, one publish. Data only.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_BRAZIL_TO_BALANCED.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapBrazilBalanced_2026_11_20.ts [--dry-run | --apply] [--expect-db <name>]
//
// The brief 5 seed's shape and safety (ellaMapDecided_2026_11_16.ts):
// --dry-run is the default and writes nothing. It prints the plan from a READ
// ONLY transaction, then rehearses --apply (the same service calls and the
// cut) in a second transaction that is always rolled back, so it can print the
// placement Brazil would get beside Benchmark and Half Moon. --apply writes in
// one transaction through catalogService.setMatchArchetypeInTx, setLeanInTx,
// setRingInTx (each logged to catalog_change with logCatalogChange, as the
// seed does) and dialPlacementService.publishInTx (the one publish door), then
// refreshes Brazil's cupping dial signal after commit, as setMatchArchetype
// does. Idempotent: a second run writes nothing and publishes nothing.
//
// Decision 1: source 'cupping' on the brief-10 session (found by its record
// source; STOP if it is missing). The confidence is read, not assumed, as the
// coffee presentation loaders do (setMatch2916/2917): 'high' when at least two
// cupper rows of that session all call balanced_sweet, else 'medium'. The
// basis JSON is composeBasis's over the current evidence (getBasisRows),
// finalized with the brief's note as the rule.
// Decision 2: lean toward chocolate_nutty, translated with dial_wedge (laneFor).
// Decision 3: ring 0. Decision 4: nothing else is touched.
// Decision 5: label 'L<n> Brazil to Balanced (cupping 2026-11-20)', n = the
// active version's number + 1.
//
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';
import type { ArchetypeCode } from '../services/catalogService.js';
import { laneFor } from './ellaMapDecided_2026_11_16.js';

export const ACTOR = 'script:ellaMapBrazilBalanced_2026_11_20';
export const ROASTER = 'Joe Bean Roasters';
export const COFFEE = 'Brazil';
export const FAMILY = 'balanced_sweet';
export const TOWARD = 'chocolate_nutty';
export const RING = 0;
export const SESSION_SOURCE = 'paper: Cupping - Nov 20 2026.pdf (4 pages; misc/roasteries/Cupping)';
export const LABEL_TAIL = 'Brazil to Balanced (cupping 2026-11-20)';
const LABEL_RE = /^L(\d+)\b/;

export const basisNote = (sessionId: number) =>
  `Dana 2026-11-20 after the cupping of 2026-11-20 (session ${sessionId}): very round and very sweet; her call Balance; Sweetness 12/15 from both cuppers; roaster proposed balanced_sweet (portal v1, 2026-10-14). Was chocolate_nutty, middle, ring 1 (assumption map 2026-11-16).`;
export const leanNote = (sessionId: number) =>
  `Dana 2026-11-20: Brazil to Balanced (cupping session ${sessionId}); lean toward chocolate_nutty, the lane of Benchmark and Half Moon (brief 9 decision 2)`;
export const ringNote = (sessionId: number) =>
  `Dana 2026-11-20: Brazil to Balanced (cupping session ${sessionId}); ring 0, the center family's ring (brief 9 decision 3)`;

type Action = 'write' | 'same';
export interface PlanRow { section: 'family' | 'lean' | 'ring' | 'publish'; now: string; next: string; action: Action }
export interface Plan {
  coffeeId: number; sessionId: number; confidence: 'high' | 'medium'; lane: string; label: string;
  activeVersion: { id: number; label: string } | null;
  familyInput: { coffeeId: number; archetype: ArchetypeCode; confidence: 'high' | 'medium'; source: 'cupping'; sessionId: number; notes: string; basis: Record<string, unknown> };
  basisText: string; ruleRequired: boolean;
  rows: PlanRow[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Read-only: what --apply would write. Throws (STOP) on a precondition the brief names. */
export async function planBrazilBalanced(tx: Tx): Promise<Plan> {
  const { getBasisRows } = await import('../services/evidenceReads.js');
  const { listSessions } = await import('../services/cuppingReads.js');
  const { composeBasis, finalizeBasis, ruleRequired } = await import('../services/evidenceBasis.js');

  const c = (await tx.query<{ id: number }>(
    `SELECT c.id FROM coffees c JOIN roaster r ON r.id = c.roaster_id WHERE c.is_active AND r.name = $1 AND c.name = $2`, [ROASTER, COFFEE])).rows;
  if (c.length !== 1) throw new Error(`STOP: ('${ROASTER}', '${COFFEE}') has ${c.length} active rows; expected one`);
  const coffeeId = c[0].id;

  const sessions = (await listSessions(tx as never)).filter((s: { record_source: string }) => s.record_source === SESSION_SOURCE);
  if (sessions.length !== 1) throw new Error(`STOP: cupping evidence brief 10 has not run here (${sessions.length} sessions with its record source)`);
  const sessionId = Number(sessions[0].id);

  // the basis, composed as the workbench and the coffee presentation loaders do
  const rows = await getBasisRows(coffeeId, tx);
  const a = rows.archetype ?? {};
  const basisInput = {
    archetype: {
      assigned_from_session_id: num(a.assigned_from_session_id), latest_session_id: num(a.latest_session_id),
      is_blind: (a.is_blind as boolean | null) ?? null, roaster_present: (a.roaster_present as boolean | null) ?? null,
      roaster_form_proposal: (a.roaster_form_proposal as string | null) ?? null,
      roaster_remark_proposals: (a.roaster_remark_proposals as string[] | null) ?? null,
    },
    calls: rows.calls.map(r => ({ cupper_id: Number(r.cupper_id), cupper_name: String(r.cupper_name), session_id: num(r.session_id), archetype_call: (r.archetype_call as string | null) ?? null })),
    sessionId,
    roasterForm: rows.roasterResponse ? { version: num(rows.roasterResponse.version), respondent: rows.roasterResponse.respondent_name } : null,
    website: rows.websiteDescriptors.map(w => String(w.remark)),
    placement: null,
  };
  const note = basisNote(sessionId);
  const composed = composeBasis(basisInput);
  const final = finalizeBasis(composed, note);
  const sessionCalls = basisInput.calls.filter(x => x.session_id === sessionId);
  const confidence = sessionCalls.length >= 2 && sessionCalls.every(x => x.archetype_call === FAMILY) ? 'high' : 'medium';

  const sides = new Map((await tx.query<{ archetype_code: string; side_a_archetype: string; side_b_archetype: string }>(
    `SELECT archetype_code::text, side_a_archetype::text, side_b_archetype::text FROM dial_wedge`)).rows.map(w => [w.archetype_code, w]));
  const lane = laneFor(sides, FAMILY, TOWARD);

  const fam = (await tx.query<{ archetype: string; confidence: string; source: string; assigned_from_session_id: number | null }>(
    `SELECT archetype::text, confidence::text, source::text, assigned_from_session_id FROM coffee_archetype_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [coffeeId])).rows[0];
  const ln = (await tx.query<{ code: string }>(
    `SELECT l.code FROM coffee_lean_assignment a JOIN dial_lane l ON l.id = a.lane_id WHERE a.coffee_id = $1 AND a.superseded_at IS NULL`, [coffeeId])).rows[0]?.code ?? null;
  const rg = (await tx.query<{ ring: number }>(`SELECT ring FROM coffee_ring_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [coffeeId])).rows[0]?.ring ?? null;

  const famNow = fam ? `${fam.archetype} (${fam.confidence}, ${fam.source}${fam.assigned_from_session_id ? `, s${fam.assigned_from_session_id}` : ''})` : '(none)';
  const famSame = !!fam && fam.archetype === FAMILY && fam.source === 'cupping' && Number(fam.assigned_from_session_id) === sessionId;
  const rows_: PlanRow[] = [
    { section: 'family', now: famNow, next: `${FAMILY} (${confidence}, cupping, s${sessionId})`, action: famSame ? 'same' : 'write' },
    { section: 'lean', now: ln ?? '(none)', next: lane, action: ln === lane ? 'same' : 'write' },
    { section: 'ring', now: rg === null ? '(none)' : String(rg), next: String(RING), action: rg !== null && Number(rg) === RING ? 'same' : 'write' },
  ];

  // decision 5: publish only when the active version does not already carry the three decisions
  const av = (await tx.query<{ id: number; label: string }>(
    `SELECT id, label FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0] ?? null;
  const m = av ? LABEL_RE.exec(av.label) : null;
  if (av && !m) throw new Error(`STOP: the active version's label '${av.label}' has no L<n> number to continue`);
  const label = `L${m ? Number(m[1]) + 1 : 0} ${LABEL_TAIL}`;
  const placed = av ? (await tx.query<{ archetype_code: string; ring: number; lane: string }>(
    `SELECT p.archetype_code::text, p.ring, l.code AS lane FROM dial_placement p JOIN dial_lane l ON l.id = p.lane_id WHERE p.version_id = $1 AND p.coffee_id = $2`,
    [av.id, coffeeId])).rows[0] : undefined;
  const onMap = !!placed && placed.archetype_code === FAMILY && Number(placed.ring) === RING && placed.lane === lane;
  rows_.push({ section: 'publish', now: av ? `${av.label} (v${av.id}): Brazil ${placed ? `${placed.archetype_code}, ${placed.lane}, ring ${placed.ring}` : 'not placed'}` : '(no active version)',
    next: label, action: onMap ? 'same' : 'write' });

  return {
    coffeeId, sessionId, confidence, lane, label, activeVersion: av,
    familyInput: { coffeeId, archetype: FAMILY as ArchetypeCode, confidence, source: 'cupping', sessionId, notes: note, basis: final.json as unknown as Record<string, unknown> },
    basisText: composed.text, ruleRequired: ruleRequired(basisInput, FAMILY), rows: rows_,
  };
}

export interface ApplyResult { plan: Plan; written: number; familyChanged: boolean; published: { versionId: number; label: string; placements: number; retiredVersionId: number | null } | null }

/** --apply (or the rehearsal), inside the caller's transaction: family, lean, ring, then publish. */
export async function applyBrazilBalanced(tx: Tx): Promise<ApplyResult> {
  const { setMatchArchetypeInTx, setLeanInTx, setRingInTx, logCatalogChange } = await import('../services/catalogService.js');
  const { publishInTx } = await import('../services/dialPlacementService.js');
  const plan = await planBrazilBalanced(tx);
  const isWrite = (s: PlanRow['section']) => plan.rows.some(r => r.section === s && r.action === 'write');
  let written = 0;
  let familyChanged = false;
  const id = plan.coffeeId;

  if (isWrite('family')) {
    const r = await setMatchArchetypeInTx(tx, plan.familyInput);
    const after = (await tx.query(`SELECT * FROM coffee_archetype_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [id])).rows[0] ?? null;
    await logCatalogChange(tx, { entity: 'coffee', entityId: id, action: 'setMatchArchetype', before: r.before, after, changedBy: ACTOR });
    familyChanged = (r.before as { archetype?: string } | null)?.archetype !== FAMILY;
    written++;
  }
  if (isWrite('lean')) {
    const r = await setLeanInTx(tx, id, plan.lane, { notes: leanNote(plan.sessionId), decidedBy: ACTOR });
    if (!r.unchanged) { await logCatalogChange(tx, { entity: 'coffee', entityId: id, action: 'setLean', before: r.before, after: r.after, changedBy: ACTOR }); written++; }
  }
  if (isWrite('ring')) {
    const note = ringNote(plan.sessionId);
    const r = await setRingInTx(tx, id, RING, { notes: note, decidedBy: ACTOR, basis: { text: note } });
    if (!r.unchanged) { await logCatalogChange(tx, { entity: 'coffee', entityId: id, action: 'setRing', before: r.before, after: r.after, changedBy: ACTOR }); written++; }
  }
  let published: ApplyResult['published'] = null;
  if (isWrite('publish')) {
    published = await publishInTx(tx, { label: plan.label, reason: `Dana 2026-11-20: Brazil to Balanced after the cupping of 2026-11-20 (session ${plan.sessionId}); brief 9`, adminUid: ACTOR });
  }
  return { plan, written, familyChanged, published };
}

/** The placement rows the rehearsal or the apply reads back: Brazil beside Benchmark and Half Moon. */
async function neighbours(tx: Tx, versionId: number) {
  return (await tx.query(
    `SELECT c.name, p.archetype_code::text AS family, l.code AS lane, p.ring, p.is_center, p.size, p.ruler_value, p.sweetness, p.acidity, p.bitterness, p.body,
            g.code AS grade, p.n_sessions, p.n_cuppers, p.flags
       FROM dial_placement p JOIN coffees c ON c.id = p.coffee_id JOIN dial_lane l ON l.id = p.lane_id JOIN dial_evidence_grade g ON g.id = p.grade_id
      WHERE p.version_id = $1 AND p.archetype_code = 'balanced_sweet' ORDER BY p.ring, c.name`, [versionId])).rows;
}

async function stepsThrough(tx: Tx, coffeeId: number) {
  return (await tx.query(
    `SELECT from_coffee_name, to_coffee_name, button_word, customer_line, basis_code, is_shown, on_active_map
       FROM v_dial_step WHERE is_current AND $1 IN (from_coffee_id, to_coffee_id) ORDER BY id`, [coffeeId])).rows;
}

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '(none)';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map(r => `| ${cols.map(k => cell(r[k])).join(' | ')} |`)].join('\n');
}

export function formatPlan(plan: Plan): string {
  const w = plan.rows.filter(r => r.action === 'write').length;
  return [
    `Brazil = coffee ${plan.coffeeId}; brief-10 session ${plan.sessionId}; confidence ${plan.confidence} (read from the session's calls); lean "${TOWARD}" = lane ${plan.lane}.`,
    `Plan: ${w} write, ${plan.rows.length - w} unchanged.`, '',
    '| decision | now | next | action |', '|---|---|---|---|',
    ...plan.rows.map(r => `| ${r.section} | ${r.now} | ${r.next} | ${r.action} |`), '',
    `notes (stored): ${plan.familyInput.notes}`,
    `basis text (composeBasis): ${plan.basisText}`,
    `rule required: ${plan.ruleRequired}`,
    `basis json: ${JSON.stringify(plan.familyInput.basis)}`,
  ].join('\n');
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  if (apply && argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const i = argv.indexOf('--expect-db');
  return { apply, expectDb: i >= 0 ? argv[i + 1] : 'axisandbloom_test' };
}

class Rehearsal extends Error {}

async function main() {
  const { apply, expectDb } = parseArgs(process.argv.slice(2));
  const urlDb = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? '';
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(2);
  }
  const { db, withTransaction } = await import('../db/client.js');
  const cur = (await db.query<{ d: string }>(`SELECT current_database() AS d`)).rows[0].d;
  if (cur !== expectDb) { console.error(`REFUSING: connected to '${cur}', expected '${expectDb}'. Nothing was written.`); process.exit(2); }
  try {
    if (!apply) {
      const client = await db.connect();
      try {
        await client.query('BEGIN READ ONLY');
        console.log(`# Ella map 9 Brazil to Balanced, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        const plan = await planBrazilBalanced(client as unknown as Tx);
        console.log(formatPlan(plan));
        console.log(`\n## steps through Brazil now (v_dial_step)\n\n${table(await stepsThrough(client as unknown as Tx, plan.coffeeId))}`);
      } finally { await client.query('ROLLBACK'); client.release(); }
      // the rehearsal: the real service calls and the cut, always rolled back
      try {
        await withTransaction(async tx => {
          const r = await applyBrazilBalanced(tx);
          console.log(`\n## rehearsal (rolled back): ${r.written} decision row(s), publish ${r.published ? `"${r.published.label}" with ${r.published.placements} placements, retiring v${r.published.retiredVersionId}` : 'none'}`);
          const vid = r.published?.versionId ?? r.plan.activeVersion?.id;
          if (vid) console.log(`\n### Balanced on the version the publish would cut\n\n${table(await neighbours(tx, vid))}`);
          console.log(`\n### steps through Brazil after (v_dial_step)\n\n${table(await stepsThrough(tx, r.plan.coffeeId))}`);
          throw new Rehearsal('rolled back');
        });
      } catch (e) { if (!(e instanceof Rehearsal)) throw e; }
      console.log('\nDRY RUN: nothing was written (the rehearsal transaction was rolled back).');
      return;
    }
    const result = await withTransaction(tx => applyBrazilBalanced(tx));
    console.log(`# Ella map 9 Brazil to Balanced, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} decision row(s) written; publish ${result.published ? JSON.stringify(result.published) : 'none (the active version already carries the decisions)'}\n`);
    console.log(formatPlan(result.plan));
    if (result.familyChanged) {
      const { refreshDialSignalsAfterImport } = await import('../services/catalogService.js');
      await refreshDialSignalsAfterImport([result.plan.coffeeId]);
      console.log(`\ndial signal refreshed for coffee ${result.plan.coffeeId}`);
    }
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
