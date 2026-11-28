// Ella's Bloom Map 16 (2026-11-27), Part E: every card is measured from your
// spot. Enters, through the writers only, what the brief and Dana's answers at
// the Task 0 STOP (2026-11-27) decide:
//  * Data 1: the brief 15 rows switched off, never deleted: the step support
//    own_family and the four spot_relation rows (setReasonChoiceInTx);
//  * Data 2: Dana Q4 (d): the step word "More body, keep the fruit" becomes
//    "More body"; its line, direction, basis, notes and card clause are kept
//    (dialPlacementService.setStepInTx);
//  * Data 3: the distance tags and the summary's joiners and strength words
//    (setCustomerCopyInTx; the schema seeds them too).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_16_MEASURED_FROM_YOUR_SPOT.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapMeasuredFromSpot_2026_11_27.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. A step reaches /map through Publish: when
// the step is written, the same transaction publishes as the next
// "L<n> measured from your spot (Ella map 16)" (publishInTx) and refuses,
// rolling everything back, if any placement would move.
// Idempotent: a second run writes nothing and publishes nothing. A row edited
// since on /admin/map is kept, never overwritten. Coffees are found by their
// map name, never by id. SAFETY: refuses unless the connected database is
// exactly --expect-db (default axisandbloom_test).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapMeasuredFromSpot_2026_11_27';
export const LABEL_TAIL = 'measured from your spot (Ella map 16)';
const LABEL_RE = /^L(\d+)\b/;

/** Data 1: switched off (Dana 2026-11-27, decision 6 and the CTO call on the brief 15 tags). */
export const OFF: Array<{ kind: string; code: string }> = [
  { kind: 'step_support', code: 'own_family' },
  { kind: 'spot_relation', code: 'same_family' },
  { kind: 'spot_relation', code: 'joined_by_step' },
  { kind: 'spot_relation', code: 'leans_to_spot_family' },
  { kind: 'spot_relation', code: 'other_direction' },
];

/** Data 2: Dana Task 0 Q4 (d). */
export const RENAME: Array<{ from: string; to: string; was: string; word: string }> = [
  { from: 'La Familia', to: 'Geometric', was: 'More body, keep the fruit', word: 'More body' },
];

/** Data 3: the brief's Data 1 copy rows. */
export const COPY: Array<{ code: string; text: string }> = [
  { code: 'tag_steps_one', text: 'One step from your spot' },
  { code: 'tag_steps_many', text: '{n} steps from your spot' },
  { code: 'tag_outside_comfort', text: 'Outside your comfort zone · {steps}' },
  { code: 'tag_no_way', text: 'A different part of the map' },
  { code: 'path_join', text: ', ' },
  { code: 'path_last_join', text: ', and ' },
  { code: 'path_twice', text: 'much {word}' },
  { code: 'path_more', text: 'far {word}' },
];

export type Action = 'write' | 'same' | 'kept' | 'skip';
export interface PlanRow { section: 'choice' | 'step' | 'copy' | 'publish'; subject: string; now: string; next: string; action: Action; why?: string }
export interface Plan { rows: PlanRow[]; label: string; activeVersion: { id: number; label: string } | null }

const show = (v: string | null | undefined) => (v === null || v === undefined ? '(none)' : `"${v}"`);

async function placedByMapName(tx: Tx) {
  const r = await tx.query<{ coffee_id: number; map_name: string }>(
    `SELECT p.coffee_id, av.map_name FROM v_dial_placement p JOIN v_dial_coffee_availability av ON av.coffee_id = p.coffee_id`);
  const m = new Map<string, number>();
  const dup = new Set<string>();
  for (const x of r.rows) { if (m.has(x.map_name)) dup.add(x.map_name); m.set(x.map_name, x.coffee_id); }
  for (const d of dup) m.delete(d);
  return m;
}

interface StepRow { id: number; from_coffee_id: number; to_coffee_id: number; button_word: string; customer_line: string | null; basis_code: string; is_shown: boolean; notes: string | null }

/** Read-only: what --apply would write, row by row. */
export async function planMeasured(tx: Tx): Promise<Plan> {
  const rows: PlanRow[] = [];
  const choices = (await tx.query<{ kind_code: string; code: string; label: string; sort_order: number; is_active: boolean }>(
    `SELECT kind_code, code, label, sort_order, is_active FROM v_dial_reason_choice WHERE is_current`)).rows;
  for (const d of OFF) {
    const subject = `${d.kind} ${d.code}`;
    const cur = choices.find(c => c.kind_code === d.kind && c.code === d.code);
    if (!cur) { rows.push({ section: 'choice', subject, now: '(none)', next: '(off)', action: 'skip', why: 'no such row' }); continue; }
    rows.push({ section: 'choice', subject, now: `${cur.sort_order}. ${cur.label} (${cur.is_active ? 'on' : 'off'})`, next: `${cur.sort_order}. ${cur.label} (off)`, action: cur.is_active ? 'write' : 'same' });
  }

  const ids = await placedByMapName(tx);
  const steps = (await tx.query<StepRow>(
    `SELECT id, from_coffee_id, to_coffee_id, button_word, customer_line, basis_code, is_shown, notes FROM v_dial_step WHERE is_current`)).rows;
  for (const d of RENAME) {
    const subject = `${d.from} -> ${d.to}`;
    const a = ids.get(d.from); const b = ids.get(d.to);
    const s = a && b ? steps.find(x => x.from_coffee_id === a && x.to_coffee_id === b) : undefined;
    if (!s) { rows.push({ section: 'step', subject, now: '(no step)', next: show(d.word), action: 'skip', why: 'no current step between these coffees' }); continue; }
    const action: Action = s.button_word === d.word ? 'same' : s.button_word === d.was ? 'write' : 'kept';
    rows.push({ section: 'step', subject: `${subject} (#${s.id})`, now: `${show(s.button_word)}: ${show(s.customer_line)}`, next: `${show(d.word)}: ${show(s.customer_line)}`,
      action, why: action === 'kept' ? 'the word was edited since; kept' : undefined });
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
export async function applyMeasured(tx: Tx): Promise<ApplyResult> {
  const { setStepInTx, setReasonChoiceInTx, setCustomerCopyInTx, publishInTx } = await import('../services/dialPlacementService.js');
  const plan = await planMeasured(tx);
  const isWrite = (section: PlanRow['section'], subject: string) => plan.rows.some(r => r.section === section && r.subject.startsWith(subject) && r.action === 'write');
  let written = 0;
  let stepsWritten = 0;
  for (const d of OFF) {
    if (!isWrite('choice', `${d.kind} ${d.code}`)) continue;
    const r = await setReasonChoiceInTx(tx, { kindCode: d.kind, code: d.code, isActive: false, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  const ids = await placedByMapName(tx);
  for (const d of RENAME) {
    if (!isWrite('step', `${d.from} -> ${d.to}`)) continue;
    const a = ids.get(d.from)!; const b = ids.get(d.to)!;
    const s = (await tx.query<StepRow>(
      `SELECT id, from_coffee_id, to_coffee_id, button_word, customer_line, basis_code, is_shown, notes FROM v_dial_step
        WHERE is_current AND from_coffee_id = $1 AND to_coffee_id = $2`, [a, b])).rows[0];
    // the word only: the line, basis, shown and notes are passed through; the direction and card clause are left out (kept)
    const r = await setStepInTx(tx, {
      fromCoffeeId: a, toCoffeeId: b, buttonWord: d.word, customerLine: s.customer_line,
      basisCode: s.basis_code, isShown: s.is_shown, notes: s.notes, adminUid: ACTOR,
    });
    if (!r.unchanged) { written++; stepsWritten++; }
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
    published = await publishInTx(tx, { label: plan.label, reason: 'Ella map 16: the step word "More body, keep the fruit" is now "More body" (Dana, Task 0 Q4; no change to the map shape)', adminUid: ACTOR });
    const after = JSON.stringify((await tx.query(shape)).rows);
    if (before !== after) throw new Error('REFUSING to publish: the new version would move a placement; nothing was written');
  }
  return { plan, written, published };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('kept')} kept (edited since), ${count('skip')} skipped. Publish label: ${plan.label}`);
  for (const s of ['choice', 'step', 'copy', 'publish'] as const) {
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
        console.log(`# Ella map 16 measured from your spot, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planMeasured(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const r = await withTransaction(tx => applyMeasured(tx));
    console.log(`# Ella map 16 measured from your spot, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written`);
    console.log(r.published ? `Published: ${r.published.label} (version ${r.published.versionId}, ${r.published.placements} placements, retired v${r.published.retiredVersionId})\n` : 'Published: nothing\n');
    console.log(formatPlan(r.plan));
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
