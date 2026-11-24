// Ella's Bloom Map 10 (2026-11-23/24), Part E: the reasons on /map, Rev 2.
// Enters, through the writers only, what design Rev 2 decides:
//  * Data 1: each quiz answer's and setup feeling's sentence, restated to stand
//    alone, with the direction it argues for (dialPlacementService.setSaidBackInTx;
//    supersedes brief 9's phrases; v7_q1_b stays as it is, never quoted);
//  * Data 2: one plain sentence per coffee on the map, coffees.map_line
//    (catalogService.updateCoffeeInTx, logged with logCatalogChange);
//  * how a card is chosen: the ordered, switchable rows (setReasonChoiceInTx);
//  * the copy row no_support (setCustomerCopyInTx; the schema seeds it too).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_10_REASONS_REV2.md
// backend/src/features/ella_bloom_map/DESIGN_MAP_REASONS_REV2_2026-11-21.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapReasonsRev2_2026_11_23.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction). It
// also runs on a database without the Ella map 10 schema yet: what is missing
// reads as empty (a direction, a map_line, the choice rows); --apply refuses there.
// --apply writes in one transaction. Nothing here is a step row, so nothing is
// published (a said-back row, a map_line and a choice row take effect when written).
// Idempotent: a second run writes nothing. Every read goes through a view.
// Coffees are found by their map name (v_dial_coffee_availability.map_name of a
// placed coffee), never by id.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapReasonsRev2_2026_11_23';

/** Data 1 (design Rev 2): the sentence and the direction it argues for (null = none). v7_q1_b is not here: it stays never quoted. */
export const DATA_1: Array<{ source: 'quiz_answer' | 'coffee_feeling'; fact: string; says: string; move: 'bolder' | 'gentler' | 'different' | null }> = [
  { source: 'quiz_answer', fact: 'v7_q1_a', says: "Coffee is a daily ritual for you, and you're particular about it.", move: null },
  { source: 'quiz_answer', fact: 'v7_q1_c', says: "You're still discovering coffee.", move: 'different' },
  { source: 'quiz_answer', fact: 'v7_q2_a', says: 'For you, a good cup is strong and satisfying.', move: 'bolder' },
  { source: 'quiz_answer', fact: 'v7_q2_b', says: 'For you, a good cup is smooth and easy the whole way.', move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_q2_c', says: 'For you, a good cup feels alive and changes as you drink it.', move: 'different' },
  { source: 'quiz_answer', fact: 'v7_q3_a', says: 'You taste a black coffee first, then make it richer.', move: null },
  { source: 'quiz_answer', fact: 'v7_q3_b', says: 'You smooth a black coffee before you try it.', move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_q3_c', says: 'With a black coffee, your first thought is what flavors are in it.', move: 'different' },
  { source: 'quiz_answer', fact: 'v7_q4_a', says: 'A coffee with no bitterness would bother you.', move: 'bolder' },
  { source: 'quiz_answer', fact: 'v7_q4_b', says: 'Too bitter is what would bother you most.', move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_q4_c', says: 'A cup where every sip tastes the same would bother you.', move: 'different' },
  { source: 'quiz_answer', fact: 'v7_q5_a', says: 'A little bitterness tastes serious to you.', move: 'bolder' },
  { source: 'quiz_answer', fact: 'v7_q5_b', says: "You'd rather have something gentler.", move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_q5_c', says: 'Bitter coffee tastes burnt to you.', move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_branch_cn_stay', says: 'Coffee should feel like a reward for you: warm, rich, comforting.', move: null },
  { source: 'quiz_answer', fact: 'v7_branch_cn_earthy', says: 'You want coffee with a kick: dark, strong, a bit smoky.', move: 'bolder' },
  { source: 'quiz_answer', fact: 'v7_branch_fruity_stay', says: 'For you, coffee is at its best bright and lively.', move: null },
  { source: 'quiz_answer', fact: 'v7_branch_fruity_floral', says: 'For you, coffee is at its best light and delicate, and the smell matters most.', move: 'gentler' },
  { source: 'quiz_answer', fact: 'v7_branch_bal_cozy', says: "You'd be sad to lose the cozy, dessert-like feeling.", move: null },
  { source: 'quiz_answer', fact: 'v7_branch_bal_fruit', says: "You'd be sad to lose that little sweetness that reminds you of fruit.", move: 'different' },
  { source: 'quiz_answer', fact: 'v7_branch_bal_floral', says: "You'd be sad to lose the smell.", move: null },
  { source: 'coffee_feeling', fact: 'bolder', says: "You'd like something bolder than what you drink now.", move: 'bolder' },
  { source: 'coffee_feeling', fact: 'gentler', says: "You'd like something gentler than what you drink now.", move: 'gentler' },
  { source: 'coffee_feeling', fact: 'different', says: "You'd like a change from what you drink now.", move: 'different' },
];

/** Data 2 (design Rev 2; Indonesia from its roaster notes, approved 2026-11-24): one plain sentence per coffee, by map name. */
export const DATA_2: Array<{ coffee: string; line: string }> = [
  { coffee: 'Benchmark', line: 'This is the cup where nothing sticks out: pure chocolate, round and soft.' },
  { coffee: 'Half Moon', line: 'Half the caffeine, with walnut and toffee.' },
  { coffee: 'Brazil', line: 'The base on its own: chocolate, almond and honey.' },
  { coffee: 'The Daily', line: 'Chocolate with some strength: our everyday cup.' },
  { coffee: 'Fabricator', line: 'Chocolate and nut first, with a little citrus and a dry finish.' },
  { coffee: 'Tiger Stripe', line: 'Chocolate first, with a little lift. Built for espresso.' },
  { coffee: 'Blossom', line: 'A darker roast with a fuller body.' },
  { coffee: 'The Waverly', line: 'Fig and orange over dark chocolate.' },
  { coffee: 'Nightcap Decaf', line: 'No caffeine, with almond, molasses and cola.' },
  { coffee: 'Amsterdam', line: 'Deep and smooth, with dark chocolate and walnut.' },
  { coffee: 'Great Heights', line: 'The same idea as Amsterdam, roasted darker.' },
  { coffee: 'Big City', line: 'French roast and burnt sugar.' },
  { coffee: 'Indonesia', line: 'Dark chocolate, apricot and caramel, with raisin and cedar.' },
  { coffee: 'Geometric', line: 'Bright fruit over caramel.' },
  { coffee: 'La Familia', line: 'Caramel and honey, with a little clementine at the end.' },
  { coffee: 'D.R. Congo', line: 'Clementine and nectarine over caramel and light chocolate.' },
  { coffee: 'Cafè Feminista', line: 'Soft and tropical, with papaya and candied coconut.' },
  { coffee: 'The Village', line: 'Floral, with apple blossom and grapefruit.' },
];

/** How a card is chosen (design Rev 2, Dana 2026-11-23/24): every row on, in this order. */
export const CHOICES: Array<{ kind: 'step_support' | 'lead_source'; code: string; label: string; sortOrder: number }> = [
  { kind: 'step_support', code: 'family_and_direction', label: "An answer for the coffee's family that argues for the step's direction", sortOrder: 1 },
  { kind: 'step_support', code: 'family', label: "An answer for the coffee's family (one that argues for no direction first)", sortOrder: 2 },
  { kind: 'step_support', code: 'direction', label: "An answer that argues for the step's direction", sortOrder: 3 },
  { kind: 'lead_source', code: 'setup_answer', label: 'The setup answer names a direction a step goes', sortOrder: 1 },
  { kind: 'lead_source', code: 'start_rule', label: "The start rule's lead, on a first match", sortOrder: 2 },
  { kind: 'lead_source', code: 'strongest_support', label: 'The step with the strongest support', sortOrder: 3 },
];

/** The copy row (A5). */
export const COPY: Array<{ code: string; text: string }> = [{ code: 'no_support', text: 'Your answers point elsewhere.' }];

export type Action = 'write' | 'same' | 'skip';
export interface PlanRow { section: 'said_back' | 'map_line' | 'choice' | 'copy'; subject: string; now: string; next: string; action: Action; why?: string }
export interface Plan { rows: PlanRow[]; schemaPresent: boolean }

const show = (v: string | null | undefined) => (v === null || v === undefined ? '(none)' : `"${v}"`);
const saidShow = (says: string | null, move: string | null) => (says === null ? '(none)' : `"${says}" / ${move ?? 'no direction'}`);

const hasSchema = async (tx: Tx) => (await tx.query<{ r: string | null }>(`SELECT to_regclass('v_dial_reason_choice')::text AS r`)).rows[0].r !== null;

/** Map name -> placed coffee (v_dial_placement, v_dial_coffee_availability); an ambiguous name resolves to nothing. */
async function placedByMapName(tx: Tx, schema = true) {
  const r = await tx.query<{ coffee_id: number; map_name: string; map_line: string | null }>(
    `SELECT p.coffee_id, av.map_name, ${schema ? 'av.map_line' : 'NULL::text AS map_line'} FROM v_dial_placement p JOIN v_dial_coffee_availability av ON av.coffee_id = p.coffee_id`);
  const m = new Map<string, { coffee_id: number; map_line: string | null }>();
  const dup = new Set<string>();
  for (const x of r.rows) { if (m.has(x.map_name)) dup.add(x.map_name); m.set(x.map_name, { coffee_id: x.coffee_id, map_line: x.map_line }); }
  for (const d of dup) m.delete(d);
  return m;
}

/** Read-only: what --apply would write, row by row. */
export async function planRev2(tx: Tx): Promise<Plan> {
  const rows: PlanRow[] = [];
  const schema = await hasSchema(tx);
  const facts = new Map((await tx.query<{ source_code: string; fact_code: string; says_back: string | null; move_code: string | null }>(
    `SELECT source_code, fact_code, says_back, ${schema ? 'move_code' : 'NULL::text AS move_code'} FROM v_dial_said_back_fact`)).rows.map(x => [`${x.source_code}:${x.fact_code}`, x]));
  for (const d of DATA_1) {
    const subject = `${d.source} ${d.fact}`;
    const cur = facts.get(`${d.source}:${d.fact}`);
    const next = saidShow(d.says, d.move);
    if (!cur) { rows.push({ section: 'said_back', subject, now: '(no current fact)', next, action: 'skip', why: 'no current answer or brew value with this code' }); continue; }
    const now = saidShow(cur.says_back, cur.move_code);
    rows.push({ section: 'said_back', subject, now, next, action: cur.says_back === d.says && (cur.move_code ?? null) === d.move ? 'same' : 'write' });
  }

  const placed = await placedByMapName(tx, schema);
  for (const d of DATA_2) {
    const c = placed.get(d.coffee);
    if (!c) { rows.push({ section: 'map_line', subject: d.coffee, now: '(not on the map)', next: show(d.line), action: 'skip', why: 'no single placed coffee with this map name' }); continue; }
    rows.push({ section: 'map_line', subject: d.coffee, now: show(c.map_line), next: show(d.line), action: c.map_line === d.line ? 'same' : 'write' });
  }
  for (const [name, c] of placed) {
    if (!DATA_2.some(d => d.coffee === name)) rows.push({ section: 'map_line', subject: name, now: show(c.map_line), next: '(no data)', action: 'skip', why: 'a placed coffee this script carries nothing for' });
  }

  const choices = schema ? (await tx.query<{ kind_code: string; code: string; label: string; sort_order: number; is_active: boolean }>(
    `SELECT kind_code, code, label, sort_order, is_active FROM v_dial_reason_choice WHERE is_current`)).rows : [];
  for (const d of CHOICES) {
    const cur = choices.find(c => c.kind_code === d.kind && c.code === d.code);
    const next = `${d.sortOrder}. ${d.label} (on)`;
    // A choice that exists keeps Dana's order and switch: the seed only enters a missing one.
    if (cur) { rows.push({ section: 'choice', subject: `${d.kind} ${d.code}`, now: `${cur.sort_order}. ${cur.label} (${cur.is_active ? 'on' : 'off'})`, next, action: 'same', why: 'exists; its order and switch are kept' }); continue; }
    rows.push({ section: 'choice', subject: `${d.kind} ${d.code}`, now: '(none)', next, action: 'write' });
  }

  const copy = new Map((await tx.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(x => [x.code, x.text]));
  for (const d of COPY) {
    const now = copy.get(d.code) ?? null;
    rows.push({ section: 'copy', subject: d.code, now: show(now), next: show(d.text), action: now === d.text ? 'same' : 'write' });
  }
  return { rows, schemaPresent: schema };
}

export interface ApplyResult { plan: Plan; written: number }

/** --apply inside the caller's transaction: exactly the plan's write rows, through the writers. */
export async function applyRev2(tx: Tx): Promise<ApplyResult> {
  const { setSaidBackInTx, setReasonChoiceInTx, setCustomerCopyInTx } = await import('../services/dialPlacementService.js');
  const { updateCoffeeInTx, logCatalogChange } = await import('../services/catalogService.js');
  const plan = await planRev2(tx);
  if (!plan.schemaPresent) throw new Error('the Ella map 10 schema is not on this database yet; deploy first');
  const isWrite = (section: PlanRow['section'], subject: string) => plan.rows.some(r => r.section === section && r.subject === subject && r.action === 'write');
  let written = 0;
  for (const d of DATA_1) {
    if (!isWrite('said_back', `${d.source} ${d.fact}`)) continue;
    const r = await setSaidBackInTx(tx, { sourceCode: d.source, factCode: d.fact, saysBack: d.says, moveCode: d.move, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  const placed = await placedByMapName(tx);
  for (const d of DATA_2) {
    if (!isWrite('map_line', d.coffee)) continue;
    const id = placed.get(d.coffee)!.coffee_id;
    const r = await updateCoffeeInTx(tx, { coffeeId: id, mapLine: d.line });
    await logCatalogChange(tx, { entity: 'coffee', entityId: id, action: 'updateCoffee', before: r.before, after: r.after, changedBy: ACTOR });
    written++;
  }
  for (const d of CHOICES) {
    if (!isWrite('choice', `${d.kind} ${d.code}`)) continue;
    const r = await setReasonChoiceInTx(tx, { kindCode: d.kind, code: d.code, label: d.label, sortOrder: d.sortOrder, isActive: true, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  for (const d of COPY) {
    if (!isWrite('copy', d.code)) continue;
    await setCustomerCopyInTx(tx, { code: d.code, text: d.text, adminUid: ACTOR });
    written++;
  }
  return { plan, written };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('skip')} skipped.${plan.schemaPresent ? '' : ' (The Ella map 10 schema is not on this database yet: directions, map_line and the choice rows read as empty.)'}`);
  for (const s of ['said_back', 'map_line', 'choice', 'copy'] as const) {
    const rows = plan.rows.filter(r => r.section === s);
    out.push('', `## ${s} (${rows.filter(r => r.action === 'write').length} write)`, '', '| subject | now | next | action |', '|---|---|---|---|');
    for (const r of rows) out.push(`| ${r.subject} | ${r.now} | ${r.next} | ${r.action}${r.why ? ` (${r.why})` : ''} |`);
  }
  return out.join('\n');
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  if (apply && argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const at = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  return { apply, expectDb: at('--expect-db') ?? 'axisandbloom_test' };
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
        console.log(`# Ella map 10 reasons Rev 2, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planRev2(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
    } else {
      const r = await withTransaction(tx => applyRev2(tx));
      console.log(`# Ella map 10 reasons Rev 2, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written\n`);
      console.log(formatPlan(r.plan));
    }
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
