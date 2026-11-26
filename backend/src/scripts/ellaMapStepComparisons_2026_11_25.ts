// Ella's Bloom Map 12 (2026-11-25/26), Part E: every step card compares to the
// coffee the customer is on, and the treat answer on step cards.
// Enters, through the writers only, what the brief and Dana's answers at the
// Task 0 STOP (2026-11-26) decide:
//  * Data 1: the 36 shown steps' lines, each a comparison to {from} (the
//    position coffee's map name, filled at read), with F1 to F8 as Dana chose
//    (dialPlacementService.setStepInTx; only the line changes: the coffees,
//    word, direction, opening clause, basis and switch are kept);
//  * Data 2: the three treat answers' sentences (setSaidBackInTx, no direction);
//  * how a card is chosen: the step-support row treat, last, on (setReasonChoiceInTx);
//  * the copy row more_about (setCustomerCopyInTx; the schema seeds it too).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_12_STEP_COMPARISONS_AND_REVEAL.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapStepComparisons_2026_11_25.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. A step line reaches /map through Publish
// (brief 9): when a step line is written, the same transaction publishes as
// the next "L<n> step comparisons (Ella map 12)" (dialPlacementService.publishInTx)
// and refuses, rolling everything back, if any placement would move.
// Idempotent: a second run writes nothing and publishes nothing.
// Every read goes through a view. Coffees are found by their map name
// (v_dial_coffee_availability.map_name of a placed coffee), never by id.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapStepComparisons_2026_11_25';
export const LABEL_TAIL = 'step comparisons (Ella map 12)';
const LABEL_RE = /^L(\d+)\b/;

/**
 * Data 1 by map name, with Dana's calls at the Task 0 STOP (2026-11-26): F2,
 * F3, F4, F6, F7, F8 take the alternatives; F5 keeps "Close to {from}" (her
 * call); F1 is her own wording ("The roaster called them cousins"); F9 stays.
 */
export const DATA_1: Array<{ from: string; to: string; line: string }> = [
  { from: 'Benchmark', to: 'The Daily', line: 'The same chocolate as {from}, livelier, with a bit more bite.' },
  { from: 'The Daily', to: 'Benchmark', line: 'The same chocolate as {from}, rounder and softer.' },
  { from: 'The Daily', to: 'Amsterdam', line: 'A step darker than {from}: smoother, with less acidity.' },
  { from: 'Amsterdam', to: 'The Daily', line: 'Lighter and sweeter than {from}.' },
  { from: 'Amsterdam', to: 'Great Heights', line: 'The same Brazil as {from}, roasted darker.' },
  { from: 'Great Heights', to: 'Amsterdam', line: 'The same Brazil as {from} in a lighter roast, with more caramel.' },
  { from: 'Great Heights', to: 'Big City', line: 'Darker again than {from}: French roast and burnt sugar.' },
  { from: 'Big City', to: 'Great Heights', line: 'Less smoke than {from}, more fudge.' },
  { from: 'Benchmark', to: 'La Familia', line: 'Lighter in the cup than {from}: caramel and honey, with a little clementine.' },
  { from: 'La Familia', to: 'Benchmark', line: 'Rounder than {from}: pure chocolate, less fruit.' },
  { from: 'La Familia', to: 'The Village', line: 'Just as light as {from}, with more flower and citrus.' },
  { from: 'The Village', to: 'La Familia', line: 'Softer and sweeter than {from}: caramel and honey.' },
  { from: 'The Village', to: 'Cafè Feminista', line: 'Creamier than {from}: papaya and candied coconut.' },
  { from: 'Cafè Feminista', to: 'The Village', line: 'More delicate than {from}: more floral, with grapefruit.' },
  { from: 'Fabricator', to: 'Geometric', line: 'Made from the same coffees as {from}, with more fruit, and sweeter.' }, // F1, Dana
  { from: 'Geometric', to: 'Fabricator', line: 'Made from the same coffees as {from}, with less fruit: drier and nuttier.' }, // F1, Dana
  { from: 'Fabricator', to: 'Brazil', line: 'Simpler than {from}: chocolate, almond, honey.' }, // F2
  { from: 'Brazil', to: 'Fabricator', line: 'More going on than {from}: citrus and spice added.' }, // F2
  { from: 'Brazil', to: 'Blossom', line: 'Darker than {from}, with a fuller body.' },
  { from: 'Blossom', to: 'Brazil', line: 'Lighter than {from}: plain chocolate.' },
  { from: 'Blossom', to: 'Tiger Stripe', line: 'A lighter roast than {from}, with more fruit.' },
  { from: 'Tiger Stripe', to: 'Blossom', line: 'A darker roast than {from}, with a fuller body.' }, // F3
  { from: 'Tiger Stripe', to: 'Geometric', line: 'More fruit than {from}: fruit comes first here, sweeter and lighter, with the chocolate behind it.' }, // F4
  { from: 'Geometric', to: 'Tiger Stripe', line: 'More chocolate and body than {from}, with the fruit behind.' },
  { from: 'Tiger Stripe', to: 'The Waverly', line: 'Close to {from}: chocolate underneath, with more fruit on top, fig and orange.' }, // F5 kept, Dana
  { from: 'The Waverly', to: 'Tiger Stripe', line: 'Close to {from} with less fruit: chocolate first, cherry behind.' }, // F5 kept, Dana
  { from: 'La Familia', to: 'Geometric', line: 'Keeps the fruit of {from} and adds weight: bright fruit over caramel.' },
  { from: 'Geometric', to: 'La Familia', line: 'Lighter and sweeter than {from}: caramel, honey, a little clementine.' },
  { from: 'Benchmark', to: 'Fabricator', line: 'More going on than {from}: hazelnut, a little citrus, a dry finish.' },
  { from: 'Fabricator', to: 'Benchmark', line: 'Rounder than {from}: pure chocolate, softer, no citrus.' },
  { from: 'D.R. Congo', to: 'Geometric', line: 'More body than {from}: bright fruit over caramel.' },
  { from: 'Geometric', to: 'D.R. Congo', line: 'Lighter than {from}: clementine and nectarine over caramel and light chocolate.' }, // F7
  { from: 'Blossom', to: 'Indonesia', line: 'Earthier than {from}: dark chocolate, apricot and caramel, with raisin and cedar.' },
  { from: 'Indonesia', to: 'Blossom', line: 'Cleaner than {from}: dark chocolate, black cherry and toffee.' }, // F6
  { from: 'Half Moon', to: 'Nightcap Decaf', line: 'No caffeine at all, where {from} has half: almond, molasses, cola.' },
  { from: 'Nightcap Decaf', to: 'Half Moon', line: 'Half the caffeine back, where {from} has none: walnut and toffee.' }, // F8
];

/** Data 2: the treat answers' sentences (no direction). */
export const DATA_2: Array<{ fact: string; says: string }> = [
  { fact: 'v7_q6_a', says: "Next to your coffee, you'd reach for something rich and comforting." },
  { fact: 'v7_q6_b', says: "Next to your coffee, you'd reach for something soft and sweet." },
  { fact: 'v7_q6_c', says: "Next to your coffee, you'd reach for something fresh and lively." },
];

/** The step-support row: last after the three of Ella map 10, on. */
export const CHOICE = { kind: 'step_support', code: 'treat', label: "The treat answer, when its family is the coffee's (step cards only, after every other kind)", sortOrder: 4 } as const;

export const COPY: Array<{ code: string; text: string }> = [{ code: 'more_about', text: 'More about this coffee' }];

export type Action = 'write' | 'same' | 'skip';
export interface PlanRow { section: 'step' | 'said_back' | 'choice' | 'copy' | 'publish'; subject: string; now: string; next: string; action: Action; why?: string }
export interface Plan { rows: PlanRow[]; label: string; activeVersion: { id: number; label: string } | null }

const show = (v: string | null | undefined) => (v === null || v === undefined ? '(none)' : `"${v}"`);

/** Map name -> placed coffee id (v_dial_placement, v_dial_coffee_availability); an ambiguous name resolves to nothing. */
async function placedByMapName(tx: Tx) {
  const r = await tx.query<{ coffee_id: number; map_name: string }>(
    `SELECT p.coffee_id, av.map_name FROM v_dial_placement p JOIN v_dial_coffee_availability av ON av.coffee_id = p.coffee_id`);
  const m = new Map<string, number>();
  const dup = new Set<string>();
  for (const x of r.rows) { if (m.has(x.map_name)) dup.add(x.map_name); m.set(x.map_name, x.coffee_id); }
  for (const d of dup) m.delete(d);
  return m;
}

interface StepRow { id: number; from_coffee_id: number; to_coffee_id: number; button_word: string; customer_line: string | null; basis_code: string; is_shown: boolean }
const shownSteps = async (tx: Tx) => (await tx.query<StepRow>(
  `SELECT id, from_coffee_id, to_coffee_id, button_word, customer_line, basis_code, is_shown FROM v_dial_step WHERE is_current AND is_shown`)).rows;

/** Read-only: what --apply would write, row by row. */
export async function planComparisons(tx: Tx): Promise<Plan> {
  const rows: PlanRow[] = [];
  const ids = await placedByMapName(tx);
  const steps = await shownSteps(tx);
  const nameOf = new Map([...ids].map(([n, id]) => [id, n]));
  const covered = new Set<number>();
  for (const d of DATA_1) {
    const subject = `${d.from} -> ${d.to}`;
    const a = ids.get(d.from); const b = ids.get(d.to);
    const s = a && b ? steps.find(x => x.from_coffee_id === a && x.to_coffee_id === b) : undefined;
    if (!s) { rows.push({ section: 'step', subject, now: '(no current shown step)', next: show(d.line), action: 'skip', why: 'no current shown step between these placed coffees' }); continue; }
    covered.add(s.id);
    rows.push({ section: 'step', subject: `${subject} (#${s.id} ${s.button_word})`, now: show(s.customer_line), next: show(d.line), action: s.customer_line === d.line ? 'same' : 'write' });
  }
  for (const s of steps) {
    if (!covered.has(s.id)) rows.push({ section: 'step', subject: `${nameOf.get(s.from_coffee_id) ?? s.from_coffee_id} -> ${nameOf.get(s.to_coffee_id) ?? s.to_coffee_id} (#${s.id})`, now: show(s.customer_line), next: '(no data)', action: 'skip', why: 'a shown step this script carries nothing for' });
  }

  const facts = new Map((await tx.query<{ fact_code: string; says_back: string | null; move_code: string | null }>(
    `SELECT fact_code, says_back, move_code FROM v_dial_said_back_fact WHERE source_code = 'quiz_answer'`)).rows.map(x => [x.fact_code, x]));
  for (const d of DATA_2) {
    const cur = facts.get(d.fact);
    if (!cur) { rows.push({ section: 'said_back', subject: `quiz_answer ${d.fact}`, now: '(no current answer)', next: show(d.says), action: 'skip', why: 'no current answer with this code' }); continue; }
    rows.push({ section: 'said_back', subject: `quiz_answer ${d.fact}`, now: show(cur.says_back), next: show(d.says), action: cur.says_back === d.says && cur.move_code === null ? 'same' : 'write' });
  }

  const choice = (await tx.query<{ label: string; sort_order: number; is_active: boolean }>(
    `SELECT label, sort_order, is_active FROM v_dial_reason_choice WHERE is_current AND kind_code = $1 AND code = $2`, [CHOICE.kind, CHOICE.code])).rows[0];
  const nextChoice = `${CHOICE.sortOrder}. ${CHOICE.label} (on)`;
  // A choice that exists keeps Dana's order and switch: the seed only enters a missing one.
  rows.push(choice
    ? { section: 'choice', subject: `${CHOICE.kind} ${CHOICE.code}`, now: `${choice.sort_order}. ${choice.label} (${choice.is_active ? 'on' : 'off'})`, next: nextChoice, action: 'same', why: 'exists; its order and switch are kept' }
    : { section: 'choice', subject: `${CHOICE.kind} ${CHOICE.code}`, now: '(none)', next: nextChoice, action: 'write' });

  const copy = new Map((await tx.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(x => [x.code, x.text]));
  for (const d of COPY) {
    const now = copy.get(d.code) ?? null;
    rows.push({ section: 'copy', subject: d.code, now: show(now), next: show(d.text), action: now === d.text ? 'same' : 'write' });
  }

  const { activeVersion } = await import('../services/dialReads.js');
  const av = await activeVersion(tx);
  const m = av ? LABEL_RE.exec(av.label) : null;
  if (av && !m) throw new Error(`STOP: the active version's label '${av.label}' has no L<n> number to continue`);
  const label = `L${m ? Number(m[1]) + 1 : 0} ${LABEL_TAIL}`;
  const anyStep = rows.some(r => r.section === 'step' && r.action === 'write');
  rows.push({ section: 'publish', subject: 'map version', now: av ? `${av.label} (v${av.id})` : '(no active version)', next: anyStep ? label : '(nothing to publish)', action: anyStep ? 'write' : 'same' });
  return { rows, label, activeVersion: av };
}

export interface ApplyResult { plan: Plan; written: number; published: { versionId: number; label: string; placements: number; retiredVersionId: number | null } | null }

/** --apply inside the caller's transaction: exactly the plan's write rows, through the writers; then the publish. */
export async function applyComparisons(tx: Tx): Promise<ApplyResult> {
  const { setStepInTx, setSaidBackInTx, setReasonChoiceInTx, setCustomerCopyInTx, publishInTx } = await import('../services/dialPlacementService.js');
  const plan = await planComparisons(tx);
  const ids = await placedByMapName(tx);
  const steps = await shownSteps(tx);
  const isWrite = (section: PlanRow['section'], subject: string) => plan.rows.some(r => r.section === section && r.subject.startsWith(subject) && r.action === 'write');
  let written = 0;
  let stepsWritten = 0;
  for (const d of DATA_1) {
    if (!isWrite('step', `${d.from} -> ${d.to} (`)) continue;
    const s = steps.find(x => x.from_coffee_id === ids.get(d.from) && x.to_coffee_id === ids.get(d.to))!;
    // only the line: word, basis and switch as they are; direction, opening clause and notes kept (undefined)
    const r = await setStepInTx(tx, {
      fromCoffeeId: s.from_coffee_id, toCoffeeId: s.to_coffee_id, buttonWord: s.button_word, customerLine: d.line,
      basisCode: s.basis_code, isShown: s.is_shown, adminUid: ACTOR,
    });
    if (!r.unchanged) { written++; stepsWritten++; }
  }
  for (const d of DATA_2) {
    if (!isWrite('said_back', `quiz_answer ${d.fact}`)) continue;
    const r = await setSaidBackInTx(tx, { sourceCode: 'quiz_answer', factCode: d.fact, saysBack: d.says, moveCode: null, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  if (isWrite('choice', `${CHOICE.kind} ${CHOICE.code}`)) {
    const r = await setReasonChoiceInTx(tx, { kindCode: CHOICE.kind, code: CHOICE.code, label: CHOICE.label, sortOrder: CHOICE.sortOrder, isActive: true, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  for (const d of COPY) {
    if (!isWrite('copy', d.code)) continue;
    await setCustomerCopyInTx(tx, { code: d.code, text: d.text, adminUid: ACTOR });
    written++;
  }

  let published: ApplyResult['published'] = null;
  if (stepsWritten > 0) {
    const shape = `SELECT coffee_id, archetype_code::text, ring, lane_code, size FROM v_dial_placement ORDER BY coffee_id`;
    const before = JSON.stringify((await tx.query(shape)).rows);
    published = await publishInTx(tx, { label: plan.label, reason: 'Ella map 12: every shown step line compares to the coffee the customer is on (no change to the map shape)', adminUid: ACTOR });
    const after = JSON.stringify((await tx.query(shape)).rows);
    if (before !== after) throw new Error('REFUSING to publish: the new version would move a placement; nothing was written');
  }
  return { plan, written, published };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('skip')} skipped. Publish label: ${plan.label}`);
  for (const s of ['step', 'said_back', 'choice', 'copy', 'publish'] as const) {
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
        console.log(`# Ella map 12 step comparisons, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planComparisons(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const r = await withTransaction(tx => applyComparisons(tx));
    console.log(`# Ella map 12 step comparisons, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written`);
    console.log(r.published ? `Published: ${r.published.label} (version ${r.published.versionId}, ${r.published.placements} placements, retired v${r.published.retiredVersionId})\n` : 'Published: nothing\n');
    console.log(formatPlan(r.plan));
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
