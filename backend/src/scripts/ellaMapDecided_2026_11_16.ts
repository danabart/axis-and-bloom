// Ella's Bloom Map 5 (2026-11-16), B5: enters the assumption map (Data 1, 2
// and 3 of the brief) through the service functions. It does not publish.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapDecided_2026_11_16.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing: it reads the current
// decisions and prints, fact by fact, what --apply would write (it also runs
// against a database that does not have the brief-5 tables yet: those read
// as empty). --apply writes in one transaction through
// catalogService.setMatchArchetypeInTx (confidence low, source manual; Dana
// 2026-11-16), setLeanInTx, setRingInTx, evidenceParameterService.setParameterInTx
// (the first-match grade floor to 1, CTO call 4), dialPlacementService.setFirstMatchInTx
// and setStepInTx, logs each family, lean and ring change to catalog_change,
// and refreshes the cupping dial signal of a coffee whose family changed
// after commit, as setMatchArchetype does. Idempotent: a second run writes nothing.
//
// A coffee with no active `coffees` row is skipped with its facts and steps
// listed (Dana 2026-11-16, option a: Half Moon, Great Heights, Brazil,
// Indonesia, D.R. Congo come later through roasteryPortalService.acceptResponse).
//
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';
import type { ArchetypeCode } from '../services/catalogService.js';

export const NOTES = 'Assumption map, CTO session 2026-11-15/16';
export const ACTOR = 'script:ellaMapDecided_2026_11_16';
export const FIRST_MATCH_FLOOR_KEY = 'dial_min_grade_rank_first_match';
export const FIRST_MATCH_FLOOR = 1;

const JOE_COFFEE = 'Joe Coffee Company';
const JOE_BEAN = 'Joe Bean Roasters';

/** Data 1. toward = the neighbour family the lean points at, null = middle. */
export const DATA_1: Array<{ key: string; roaster: string; names: string[]; family: string; toward: string | null; ring: number }> = [
  { key: 'Benchmark',      roaster: JOE_COFFEE, names: ['Benchmark'],                         family: 'balanced_sweet',  toward: 'chocolate_nutty', ring: 0 },
  { key: 'Half Moon',      roaster: JOE_COFFEE, names: ['Half Moon', 'Half Moon (Half Caff)'], family: 'balanced_sweet',  toward: 'chocolate_nutty', ring: 0 },
  { key: 'The Daily',      roaster: JOE_COFFEE, names: ['The Daily'],                         family: 'chocolate_nutty', toward: null,              ring: 1 },
  { key: 'Brazil',         roaster: JOE_BEAN,   names: ['Brazil'],                            family: 'chocolate_nutty', toward: null,              ring: 1 },
  { key: 'Fabricator',     roaster: JOE_BEAN,   names: ['Fabricator House Roast', 'Fabricator'], family: 'chocolate_nutty', toward: 'fruity',       ring: 1 },
  { key: 'Tiger Stripe',   roaster: JOE_BEAN,   names: ['Tiger Stripe Espresso', 'Tiger Stripe'], family: 'chocolate_nutty', toward: 'fruity',      ring: 2 },
  { key: 'Blossom',        roaster: JOE_BEAN,   names: ['Blossom Dark Roast', 'Blossom'],     family: 'chocolate_nutty', toward: 'fruity',          ring: 3 },
  { key: 'The Waverly',    roaster: JOE_COFFEE, names: ['The Waverly'],                       family: 'chocolate_nutty', toward: 'fruity',          ring: 3 },
  { key: 'Nightcap Decaf', roaster: JOE_COFFEE, names: ['Nightcap Decaf'],                    family: 'chocolate_nutty', toward: 'earthy',          ring: 1 },
  { key: 'Amsterdam',      roaster: JOE_COFFEE, names: ['Amsterdam'],                         family: 'chocolate_nutty', toward: 'earthy',          ring: 2 },
  { key: 'Great Heights',  roaster: JOE_COFFEE, names: ['Great Heights'],                     family: 'chocolate_nutty', toward: 'earthy',          ring: 3 },
  { key: 'Big City',       roaster: JOE_COFFEE, names: ['Big City'],                          family: 'earthy',          toward: 'chocolate_nutty', ring: 2 },
  { key: 'Indonesia',      roaster: JOE_BEAN,   names: ['Indonesia'],                         family: 'earthy',          toward: null,              ring: 2 },
  { key: 'Geometric',      roaster: JOE_BEAN,   names: ['Geometric Filter Coffee', 'Geometric'], family: 'fruity',       toward: 'chocolate_nutty', ring: 1 },
  { key: 'La Familia',     roaster: JOE_COFFEE, names: ['Colombia La Familia Guarnizo', 'La Familia'], family: 'fruity', toward: 'floral',          ring: 1 },
  { key: 'D.R. Congo',     roaster: JOE_BEAN,   names: ['D.R. Congo'],                        family: 'fruity',          toward: null,              ring: 1 },
  { key: 'Cafè Feminista', roaster: JOE_COFFEE, names: ['Cafè Feminista: Montze Olvera', 'Cafè Feminista'], family: 'fruity', toward: null,         ring: 2 },
  { key: 'The Village',    roaster: JOE_COFFEE, names: ['The Village'],                       family: 'floral',          toward: 'fruity',          ring: 2 },
];

/** Data 2: each pair is two dial_step rows, one per direction. */
export const DATA_2: Array<{ n: number; from: string; to: string; word: string; line: string | null; backWord: string; backLine: string | null; basis: string }> = [
  { n: 1,  from: 'Benchmark',     to: 'The Daily',      word: 'Bolder',         line: 'The same chocolate, livelier, with a bit more bite.', backWord: 'Lighter', backLine: 'Rounder, pure chocolate.', basis: 'roaster_said' },
  { n: 2,  from: 'The Daily',     to: 'Amsterdam',      word: 'Bolder',         line: 'Darker and smoother, with less acidity.', backWord: 'Lighter', backLine: 'Lighter and sweeter.', basis: 'recipe_or_ratings' },
  { n: 3,  from: 'Amsterdam',     to: 'Great Heights',  word: 'Bolder',         line: 'The same Brazil, roasted darker.', backWord: 'Lighter', backLine: 'A lighter roast, with more caramel.', basis: 'recipe_or_ratings' },
  { n: 4,  from: 'Great Heights', to: 'Big City',       word: 'Bolder',         line: 'French roast and burnt sugar.', backWord: 'Lighter', backLine: 'Less smoke, more fudge.', basis: 'roaster_said' },
  { n: 5,  from: 'Benchmark',     to: 'La Familia',     word: 'Brighter',       line: 'Caramel and honey with a little clementine. Lighter in the cup.', backWord: 'More body', backLine: 'Pure chocolate, rounder, less fruit.', basis: 'recipe_or_ratings' },
  { n: 6,  from: 'La Familia',    to: 'The Village',    word: 'More delicate',  line: 'More floral and more citrus.', backWord: 'Sweeter', backLine: 'Caramel and honey, softer.', basis: 'roaster_said' },
  { n: 7,  from: 'The Village',   to: 'Cafè Feminista', word: 'More tropical',  line: 'Papaya and candied coconut, creamier.', backWord: 'More delicate', backLine: 'More floral, with grapefruit.', basis: 'roaster_said' },
  { n: 8,  from: 'Fabricator',    to: 'Geometric',      word: 'More fruit',     line: 'The same family with more fruit, and sweeter.', backWord: 'Less fruit', backLine: 'Drier and nuttier.', basis: 'roaster_said' },
  { n: 9,  from: 'Fabricator',    to: 'Brazil',         word: 'Simpler',        line: 'The base on its own: chocolate, almond, honey.', backWord: 'More going on', backLine: 'Adds citrus and spice.', basis: 'recipe_or_ratings' },
  { n: 10, from: 'Brazil',        to: 'Blossom',        word: 'Bolder',         line: 'A darker roast with a fuller body.', backWord: 'Lighter', backLine: 'Lighter, plain chocolate.', basis: 'recipe_or_ratings' },
  { n: 11, from: 'Blossom',       to: 'Tiger Stripe',   word: 'Brighter',       line: 'A lighter roast with more fruit.', backWord: 'Bolder', backLine: 'A darker roast with a fuller body.', basis: 'roaster_said' },
  { n: 12, from: 'Tiger Stripe',  to: 'Geometric',      word: 'More fruit',     line: 'More fruit, and sweeter.', backWord: 'More body', backLine: 'More chocolate and body.', basis: 'recipe_or_ratings' },
  { n: 13, from: 'Half Moon',     to: 'Nightcap Decaf', word: 'No caffeine',    line: 'Almond, molasses, cola.', backWord: 'Half the caffeine', backLine: 'Walnut and toffee.', basis: 'roaster_said' },
  { n: 14, from: 'La Familia',    to: 'Geometric',      word: 'More body, keep the fruit', line: 'Bright fruit over caramel, with more weight.', backWord: 'Lighter', backLine: 'Sweeter and lighter: caramel and honey.', basis: 'our_guess' },
  { n: 15, from: 'Benchmark',     to: 'Fabricator',     word: 'More going on',  line: 'Hazelnut, a little citrus, a dry finish.', backWord: 'Rounder', backLine: 'Pure chocolate, softer, no citrus.', basis: 'our_guess' },
  { n: 16, from: 'Tiger Stripe',  to: 'The Waverly',    word: 'More fruit',     line: 'Fig and orange over dark chocolate.', backWord: 'Less fruit', backLine: 'Chocolate first, cherry behind.', basis: 'our_guess' },
  { n: 17, from: 'D.R. Congo',    to: 'Geometric',      word: 'More body',      line: null, backWord: 'Lighter', backLine: null, basis: 'our_guess' },
  { n: 18, from: 'Blossom',       to: 'Indonesia',      word: 'Earthier',       line: null, backWord: 'Cleaner', backLine: null, basis: 'our_guess' },
];

/** Data 3: dial_first_match, status founder_pick. toward null = middle; 'all' = every lane. */
export const DATA_3: Array<{ family: string; lanes: Array<string | null> | 'all'; first: string }> = [
  { family: 'balanced_sweet',  lanes: ['chocolate_nutty', null], first: 'Benchmark' },
  { family: 'balanced_sweet',  lanes: ['fruity'],                first: 'La Familia' },
  { family: 'chocolate_nutty', lanes: [null],                    first: 'The Daily' },
  { family: 'chocolate_nutty', lanes: ['fruity'],                first: 'Fabricator' },
  { family: 'chocolate_nutty', lanes: ['earthy'],                first: 'Amsterdam' },
  { family: 'earthy',          lanes: 'all',                     first: 'Amsterdam' },
  { family: 'fruity',          lanes: ['chocolate_nutty'],       first: 'Geometric' },
  { family: 'fruity',          lanes: [null, 'floral'],          first: 'Cafè Feminista' },
  { family: 'floral',          lanes: 'all',                     first: 'The Village' },
];

export type Action = 'write' | 'same' | 'skip';
export interface PlanRow { section: 'family' | 'lean' | 'ring' | 'parameter' | 'first_match' | 'step'; subject: string; now: string; next: string; action: Action; why?: string }
export interface Plan {
  rows: PlanRow[];
  missing: string[];
  coffees: Record<string, { id: number; name: string } | null>;
}

const has = async (tx: Tx, rel: string) => (await tx.query<{ r: string | null }>(`SELECT to_regclass($1)::text AS r`, [rel])).rows[0].r !== null;

async function resolveCoffees(tx: Tx) {
  const out: Record<string, { id: number; name: string } | null> = {};
  for (const d of DATA_1) {
    const r = await tx.query<{ id: number; name: string }>(
      `SELECT c.id, c.name FROM coffees c JOIN roaster r ON r.id = c.roaster_id
        WHERE c.is_active AND r.name = $1 AND lower(c.name) = ANY($2::text[]) ORDER BY c.id`,
      [d.roaster, d.names.map(n => n.toLowerCase())]);
    if (r.rows.length > 1) throw new Error(`${d.key}: ${r.rows.length} active coffees match (${r.rows.map(x => x.id).join(', ')}); expected one`);
    out[d.key] = r.rows[0] ?? null;
  }
  return out;
}

async function wedgeSides(tx: Tx) {
  const r = await tx.query<{ archetype_code: string; side_a_archetype: string; side_b_archetype: string }>(
    `SELECT archetype_code::text, side_a_archetype::text, side_b_archetype::text FROM dial_wedge`);
  return new Map(r.rows.map(w => [w.archetype_code, w]));
}

/** Translate "toward <family>" to a lane code with dial_wedge (Task 0 item 2). */
export function laneFor(sides: Map<string, { side_a_archetype: string; side_b_archetype: string }>, family: string, toward: string | null): string {
  if (toward === null) return 'middle';
  const w = sides.get(family);
  if (!w) throw new Error(`${family} is not a map family`);
  if (w.side_a_archetype === toward) return 'side_a';
  if (w.side_b_archetype === toward) return 'side_b';
  throw new Error(`${family} has no lean toward ${toward} (its sides are ${w.side_a_archetype}, ${w.side_b_archetype})`);
}

async function lanesOf(tx: Tx) {
  return (await tx.query<{ code: string }>(`SELECT code FROM dial_lane ORDER BY sort_order`)).rows.map(r => r.code);
}

/** Read-only: what --apply would write, fact by fact. */
export async function planDecidedMap(tx: Tx): Promise<Plan> {
  const coffees = await resolveCoffees(tx);
  const sides = await wedgeSides(tx);
  const lanes = await lanesOf(tx);
  const haveRing = await has(tx, 'coffee_ring_assignment');
  const haveStep = await has(tx, 'dial_step');
  const rows: PlanRow[] = [];
  const missing = DATA_1.filter(d => !coffees[d.key]).map(d => d.key);
  const label = (key: string) => coffees[key] ? `${key} (${coffees[key]!.id})` : key;

  for (const d of DATA_1) {
    const c = coffees[d.key];
    const lane = laneFor(sides, d.family, d.toward);
    if (!c) {
      for (const [section, next] of [['family', d.family], ['lean', lane], ['ring', String(d.ring)]] as const) {
        rows.push({ section, subject: d.key, now: '', next, action: 'skip', why: 'no active coffees row' });
      }
      continue;
    }
    const fam = (await tx.query<{ archetype: string }>(
      `SELECT archetype::text FROM coffee_archetype_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [c.id])).rows[0]?.archetype ?? null;
    rows.push({ section: 'family', subject: label(d.key), now: fam ?? '(none)', next: d.family, action: fam === d.family ? 'same' : 'write' });
    const ln = (await tx.query<{ code: string }>(
      `SELECT l.code FROM coffee_lean_assignment a JOIN dial_lane l ON l.id = a.lane_id WHERE a.coffee_id = $1 AND a.superseded_at IS NULL`, [c.id])).rows[0]?.code ?? null;
    rows.push({ section: 'lean', subject: label(d.key), now: ln ?? '(none)', next: lane, action: ln === lane ? 'same' : 'write' });
    const rg = haveRing
      ? (await tx.query<{ ring: number }>(`SELECT ring FROM coffee_ring_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [c.id])).rows[0]?.ring ?? null
      : null;
    rows.push({ section: 'ring', subject: label(d.key), now: rg === null ? '(none)' : String(rg), next: String(d.ring), action: rg !== null && Number(rg) === d.ring ? 'same' : 'write' });
  }

  const floor = (await tx.query<{ v: string | null }>(`SELECT param($1) AS v`, [FIRST_MATCH_FLOOR_KEY])).rows[0].v;
  rows.push({ section: 'parameter', subject: FIRST_MATCH_FLOOR_KEY, now: floor ?? '(none)', next: String(FIRST_MATCH_FLOOR),
    action: floor !== null && Number(floor) === FIRST_MATCH_FLOOR ? 'same' : 'write' });

  for (const f of DATA_3) {
    const want = f.lanes === 'all' ? lanes : f.lanes.map(t => laneFor(sides, f.family, t));
    for (const ln of want) {
      const subject = `${f.family} x ${ln}`;
      const c = coffees[f.first];
      const cur = (await tx.query<{ coffee_id: number; name: string; status: string }>(
        `SELECT fm.coffee_id, c.name, st.code AS status FROM dial_first_match fm
           JOIN dial_lane l ON l.id = fm.lane_id JOIN coffees c ON c.id = fm.coffee_id
           JOIN dial_first_match_status st ON st.id = fm.status_id
          WHERE fm.archetype_code::text = $1 AND l.code = $2 AND fm.superseded_at IS NULL`, [f.family, ln])).rows[0];
      const now = cur ? `${cur.name} (${cur.coffee_id}, ${cur.status})` : '(none)';
      if (!c) { rows.push({ section: 'first_match', subject, now, next: f.first, action: 'skip', why: 'no active coffees row' }); continue; }
      const same = cur && cur.coffee_id === c.id && cur.status === 'founder_pick';
      rows.push({ section: 'first_match', subject, now, next: label(f.first), action: same ? 'same' : 'write' });
    }
  }

  for (const s of DATA_2) {
    for (const [from, to, word, line] of [[s.from, s.to, s.word, s.line], [s.to, s.from, s.backWord, s.backLine]] as const) {
      const subject = `#${s.n} ${from} -> ${to}`;
      const next = `"${word}" / ${line === null ? '(destination notes)' : `"${line}"`} / ${s.basis}`;
      const a = coffees[from], b = coffees[to];
      if (!a || !b) { rows.push({ section: 'step', subject, now: '', next, action: 'skip', why: `no active coffees row for ${[!a ? from : null, !b ? to : null].filter(Boolean).join(' and ')}` }); continue; }
      const cur = haveStep
        ? (await tx.query<{ button_word: string; customer_line: string | null; basis: string; is_shown: boolean }>(
            // Ella map 10 (item 4): through the table's view
            `SELECT s.button_word, s.customer_line, s.basis_code AS basis, s.is_shown FROM v_dial_step s
              WHERE s.from_coffee_id = $1 AND s.to_coffee_id = $2 AND s.is_current`, [a.id, b.id])).rows[0]
        : undefined;
      const now = cur ? `"${cur.button_word}" / ${cur.customer_line === null ? '(destination notes)' : `"${cur.customer_line}"`} / ${cur.basis}${cur.is_shown ? '' : ' / hidden'}` : '(none)';
      // a hidden step stays hidden: the seed sets words and basis, Dana's is_shown wins
      const same = cur && cur.button_word === word && cur.customer_line === line && cur.basis === s.basis;
      rows.push({ section: 'step', subject, now, next, action: same ? 'same' : 'write' });
    }
  }
  return { rows, missing, coffees };
}

export interface ApplyResult { plan: Plan; familyChanged: number[]; written: number }

/** --apply, inside the caller's transaction. Writes exactly the plan's 'write' rows, in order: family, lean, ring, floor, first match, steps. */
export async function applyDecidedMap(tx: Tx): Promise<ApplyResult> {
  const { setMatchArchetypeInTx, setLeanInTx, setRingInTx, logCatalogChange } = await import('../services/catalogService.js');
  const { setParameterInTx } = await import('../services/evidenceParameterService.js');
  const { setFirstMatchInTx, setStepInTx } = await import('../services/dialPlacementService.js');
  const plan = await planDecidedMap(tx);
  const sides = await wedgeSides(tx);
  const lanes = await lanesOf(tx);
  const familyChanged: number[] = [];
  let written = 0;
  const isWrite = (section: PlanRow['section'], key: string) =>
    plan.rows.some(r => r.section === section && r.action === 'write' && (r.subject === key || r.subject.startsWith(`${key} (`)));

  for (const d of DATA_1) {
    const c = plan.coffees[d.key];
    if (!c) continue;
    if (isWrite('family', d.key)) {
      const r = await setMatchArchetypeInTx(tx, { coffeeId: c.id, archetype: d.family as ArchetypeCode, confidence: 'low', source: 'manual', notes: NOTES });
      const after = (await tx.query(`SELECT * FROM coffee_archetype_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [c.id])).rows[0] ?? null;
      await logCatalogChange(tx, { entity: 'coffee', entityId: c.id, action: 'setMatchArchetype', before: r.before, after, changedBy: ACTOR });
      familyChanged.push(c.id); written++;
    }
  }
  for (const d of DATA_1) {
    const c = plan.coffees[d.key];
    if (!c || !isWrite('lean', d.key)) continue;
    const r = await setLeanInTx(tx, c.id, laneFor(sides, d.family, d.toward), { notes: NOTES, decidedBy: ACTOR });
    if (!r.unchanged) { await logCatalogChange(tx, { entity: 'coffee', entityId: c.id, action: 'setLean', before: r.before, after: r.after, changedBy: ACTOR }); written++; }
  }
  for (const d of DATA_1) {
    const c = plan.coffees[d.key];
    if (!c || !isWrite('ring', d.key)) continue;
    const r = await setRingInTx(tx, c.id, d.ring, { notes: NOTES, decidedBy: ACTOR, basis: { text: NOTES } });
    if (!r.unchanged) { await logCatalogChange(tx, { entity: 'coffee', entityId: c.id, action: 'setRing', before: r.before, after: r.after, changedBy: ACTOR }); written++; }
  }
  if (isWrite('parameter', FIRST_MATCH_FLOOR_KEY)) {
    const r = await setParameterInTx(tx, { key: FIRST_MATCH_FLOOR_KEY, value: FIRST_MATCH_FLOOR, note: `${NOTES}: a founder pick is never refused for its grade (CTO call 4)`, adminId: ACTOR });
    if (!r.unchanged) written++;
  }
  for (const f of DATA_3) {
    const c = plan.coffees[f.first];
    if (!c) continue;
    const want = f.lanes === 'all' ? lanes : f.lanes.map(t => laneFor(sides, f.family, t));
    for (const ln of want) {
      if (!isWrite('first_match', `${f.family} x ${ln}`)) continue;
      const r = await setFirstMatchInTx(tx, { archetypeCode: f.family, laneCode: ln, coffeeId: c.id, statusCode: 'founder_pick', notes: NOTES, adminUid: ACTOR });
      if (!r.unchanged) written++;
    }
  }
  for (const s of DATA_2) {
    for (const [from, to, word, line] of [[s.from, s.to, s.word, s.line], [s.to, s.from, s.backWord, s.backLine]] as const) {
      const a = plan.coffees[from], b = plan.coffees[to];
      if (!a || !b || !isWrite('step', `#${s.n} ${from} -> ${to}`)) continue;
      const cur = (await tx.query<{ is_shown: boolean }>(
        `SELECT is_shown FROM v_dial_step WHERE from_coffee_id = $1 AND to_coffee_id = $2 AND is_current`, [a.id, b.id])).rows[0];
      const r = await setStepInTx(tx, { fromCoffeeId: a.id, toCoffeeId: b.id, buttonWord: word, customerLine: line, basisCode: s.basis,
        isShown: cur?.is_shown ?? true, notes: NOTES, adminUid: ACTOR });
      if (!r.unchanged) written++;
    }
  }
  return { plan, familyChanged, written };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const sections: PlanRow['section'][] = ['family', 'lean', 'ring', 'parameter', 'first_match', 'step'];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('skip')} skipped.`);
  if (plan.missing.length) out.push(`No active coffees row (skipped with their facts and steps): ${plan.missing.join(', ')}.`);
  for (const s of sections) {
    const rows = plan.rows.filter(r => r.section === s);
    out.push('', `## ${s} (${rows.filter(r => r.action === 'write').length} write)`, '', '| subject | now | next | action |', '|---|---|---|---|');
    for (const r of rows) out.push(`| ${r.subject} | ${r.now} | ${r.next} | ${r.action}${r.why ? ` (${r.why})` : ''} |`);
  }
  return out.join('\n');
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  if (apply && argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const i = argv.indexOf('--expect-db');
  return { apply, expectDb: i >= 0 ? argv[i + 1] : 'axisandbloom_test' };
}

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
        console.log(`# Ella map 5 seed, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planDecidedMap(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const result = await withTransaction(tx => applyDecidedMap(tx));
    console.log(`# Ella map 5 seed, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} row(s) written\n`);
    console.log(formatPlan(result.plan));
    // as setMatchArchetype does after commit, through catalogService's own wrapper (advisory; logs, never throws)
    const { refreshDialSignalsAfterImport } = await import('../services/catalogService.js');
    await refreshDialSignalsAfterImport(result.familyChanged);
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
