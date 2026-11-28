// Ella's Bloom Map 15 (2026-11-27), Part E: every card says something about
// you, and two steps from Tiger Stripe. Enters, through the writers only, what
// the brief and Dana's answers at the Task 0 STOP (2026-11-27) decide:
//  * Data 1: four steps by her one-change rule, Tiger Stripe <-> The Daily and
//    Tiger Stripe <-> Fabricator, basis our_guess (dialPlacementService.setStepInTx);
//  * Data 2: the step-support rows family_lean and own_family (after treat, in
//    that order) and the spot_relation rows same_family, joined_by_step,
//    leans_to_spot_family, other_direction (setReasonChoiceInTx);
//  * Data 3: the tag words and the heading while looking (setCustomerCopyInTx;
//    the schema seeds them too).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_15_CARDS_ABOUT_YOU.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapCardsAboutYou_2026_11_27.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. A step reaches /map through Publish
// (brief 9): when a step is written, the same transaction publishes as the
// next "L<n> one change from Tiger Stripe (Ella map 15)" (publishInTx) and
// refuses, rolling everything back, if any placement would move.
// Idempotent: a second run writes nothing and publishes nothing. A row that
// exists and differs from the data (edited since on /admin/map) is kept, never
// overwritten. Every read goes through a view; coffees are found by their map
// name (v_dial_coffee_availability.map_name of a placed coffee), never by id.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapCardsAboutYou_2026_11_27';
export const LABEL_TAIL = 'one change from Tiger Stripe (Ella map 15)';
const LABEL_RE = /^L(\d+)\b/;
const BASIS = 'our_guess'; // decided by Dana 2026-11-27

/** Data 1, with Dana's answer 1 at the Task 0 STOP (2026-11-27). */
export const DATA_1: Array<{ from: string; to: string; word: string; move: string; line: string }> = [
  { from: 'Tiger Stripe', to: 'The Daily', word: 'Less fruit', move: 'different', line: '{from} without the fruit: chocolate and caramel, with a bit more bite.' },
  { from: 'The Daily', to: 'Tiger Stripe', word: 'More fruit', move: 'different', line: '{from} with a fruit edge: chocolate first, cherry behind. Built for espresso.' },
  { from: 'Tiger Stripe', to: 'Fabricator', word: 'Lighter', move: 'gentler', line: '{from} with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.' },
  { from: 'Fabricator', to: 'Tiger Stripe', word: 'More body', move: 'bolder', line: 'More body than {from}, with cherry where the citrus was. Built for espresso.' },
];

/** Data 2, with Dana's answers 2 and 12: the late step supports after treat; the tag rows, first match wins. */
export const CHOICES: Array<{ kind: string; code: string; label: string; sortOrder: number }> = [
  { kind: 'step_support', code: 'family_lean', label: 'An answer for the family the coffee leans toward (after the reuse pass and treat; never a lead)', sortOrder: 5 },
  { kind: 'step_support', code: 'own_family', label: "One of the customer's own-family answers, when nothing else supports the card (last; never a lead)", sortOrder: 6 },
  { kind: 'spot_relation', code: 'same_family', label: "The coffee is in the spot's family", sortOrder: 1 },
  { kind: 'spot_relation', code: 'joined_by_step', label: 'A published step joins the coffee and the spot, either way', sortOrder: 2 },
  { kind: 'spot_relation', code: 'leans_to_spot_family', label: "The coffee leans toward the spot's family", sortOrder: 3 },
  { kind: 'spot_relation', code: 'other_direction', label: 'Anything else', sortOrder: 4 },
];

/** Data 3: one tag row per relation (tag_<code>), the spot's own tag, the heading while looking. */
export const COPY: Array<{ code: string; text: string }> = [
  { code: 'tag_same_family', text: 'Same family as your spot' },
  { code: 'tag_joined_by_step', text: 'Close to your spot' },
  { code: 'tag_leans_to_spot_family', text: 'Close to your spot' },
  { code: 'tag_other_direction', text: 'A different direction: {family}' },
  { code: 'tag_your_spot', text: 'Your spot' },
  { code: 'steps_title_from', text: 'One step from {coffee}' },
];

export type Action = 'write' | 'same' | 'kept' | 'skip';
export interface PlanRow { section: 'step' | 'choice' | 'copy' | 'publish'; subject: string; now: string; next: string; action: Action; why?: string }
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

interface StepRow { id: number; from_coffee_id: number; to_coffee_id: number; button_word: string; customer_line: string | null; basis_code: string; is_shown: boolean; move_code: string | null }
const currentSteps = async (tx: Tx) => (await tx.query<StepRow>(
  `SELECT id, from_coffee_id, to_coffee_id, button_word, customer_line, basis_code, is_shown, move_code FROM v_dial_step WHERE is_current`)).rows;
const stepText = (s: { button_word: string; move_code: string | null; customer_line: string | null; basis_code: string; is_shown: boolean }) =>
  `${s.button_word} / ${s.move_code ?? '(no direction)'} / ${s.basis_code}${s.is_shown ? '' : ' (hidden)'}: ${show(s.customer_line)}`;

/** Read-only: what --apply would write, row by row. */
export async function planCards(tx: Tx): Promise<Plan> {
  const rows: PlanRow[] = [];
  const ids = await placedByMapName(tx);
  const steps = await currentSteps(tx);
  for (const d of DATA_1) {
    const subject = `${d.from} -> ${d.to}`;
    const a = ids.get(d.from); const b = ids.get(d.to);
    const next = stepText({ button_word: d.word, move_code: d.move, customer_line: d.line, basis_code: BASIS, is_shown: true });
    if (!a || !b) { rows.push({ section: 'step', subject, now: '(not both on the active map)', next, action: 'skip', why: 'a coffee is not placed under this map name' }); continue; }
    const s = steps.find(x => x.from_coffee_id === a && x.to_coffee_id === b);
    if (!s) { rows.push({ section: 'step', subject, now: '(no step)', next, action: 'write' }); continue; }
    const same = s.button_word === d.word && s.move_code === d.move && s.customer_line === d.line && s.basis_code === BASIS && s.is_shown;
    rows.push({ section: 'step', subject: `${subject} (#${s.id})`, now: stepText(s), next, action: same ? 'same' : 'kept', why: same ? undefined : 'a step exists and differs (edited since); kept' });
  }

  const choices = (await tx.query<{ kind_code: string; code: string; label: string; sort_order: number; is_active: boolean }>(
    `SELECT kind_code, code, label, sort_order, is_active FROM v_dial_reason_choice WHERE is_current`)).rows;
  // the spot_relation kind row is seeded by schema.sql; setReasonChoiceInTx refuses a kind that is not there
  for (const d of CHOICES) {
    const subject = `${d.kind} ${d.code}`;
    const next = `${d.sortOrder}. ${d.label} (on)`;
    const cur = choices.find(c => c.kind_code === d.kind && c.code === d.code);
    // A choice that exists keeps Dana's order and switch: the seed only enters a missing one.
    rows.push(cur
      ? { section: 'choice', subject, now: `${cur.sort_order}. ${cur.label} (${cur.is_active ? 'on' : 'off'})`, next, action: 'same', why: 'exists; its order and switch are kept' }
      : { section: 'choice', subject, now: '(none)', next, action: 'write' });
  }

  const copy = new Map((await tx.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(x => [x.code, x.text]));
  for (const d of COPY) {
    const now = copy.get(d.code);
    rows.push(now === undefined
      ? { section: 'copy', subject: d.code, now: '(none)', next: show(d.text), action: 'write' }
      : { section: 'copy', subject: d.code, now: show(now), next: show(d.text), action: now === d.text ? 'same' : 'kept', why: now === d.text ? undefined : 'edited since; kept' });
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
export async function applyCards(tx: Tx): Promise<ApplyResult> {
  const { setStepInTx, setReasonChoiceInTx, setCustomerCopyInTx, publishInTx } = await import('../services/dialPlacementService.js');
  const plan = await planCards(tx);
  const ids = await placedByMapName(tx);
  const isWrite = (section: PlanRow['section'], subject: string) => plan.rows.some(r => r.section === section && r.subject === subject && r.action === 'write');
  let written = 0;
  let stepsWritten = 0;
  for (const d of DATA_1) {
    if (!isWrite('step', `${d.from} -> ${d.to}`)) continue;
    const r = await setStepInTx(tx, {
      fromCoffeeId: ids.get(d.from)!, toCoffeeId: ids.get(d.to)!, buttonWord: d.word, customerLine: d.line,
      basisCode: BASIS, isShown: true, moveCode: d.move, adminUid: ACTOR,
    });
    if (!r.unchanged) { written++; stepsWritten++; }
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

  let published: ApplyResult['published'] = null;
  if (stepsWritten > 0) {
    const shape = `SELECT coffee_id, archetype_code::text, ring, lane_code, size FROM v_dial_placement ORDER BY coffee_id`;
    const before = JSON.stringify((await tx.query(shape)).rows);
    published = await publishInTx(tx, { label: plan.label, reason: 'Ella map 15: Tiger Stripe <-> The Daily and Tiger Stripe <-> Fabricator by the one-change rule (no change to the map shape)', adminUid: ACTOR });
    const after = JSON.stringify((await tx.query(shape)).rows);
    if (before !== after) throw new Error('REFUSING to publish: the new version would move a placement; nothing was written');
  }
  return { plan, written, published };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('kept')} kept (edited since), ${count('skip')} skipped. Publish label: ${plan.label}`);
  for (const s of ['step', 'choice', 'copy', 'publish'] as const) {
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
        console.log(`# Ella map 15 cards about you, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planCards(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const r = await withTransaction(tx => applyCards(tx));
    console.log(`# Ella map 15 cards about you, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written`);
    console.log(r.published ? `Published: ${r.published.label} (version ${r.published.versionId}, ${r.published.placements} placements, retired v${r.published.retiredVersionId})\n` : 'Published: nothing\n');
    console.log(formatPlan(r.plan));
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
