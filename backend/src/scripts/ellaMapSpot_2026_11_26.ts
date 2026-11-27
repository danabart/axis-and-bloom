// Ella's Bloom Map 14 (2026-11-27), Part A: what moves your spot, and walking the map.
// Enters, through the one writer only, what Dana decided at the Task 0 STOP (2026-11-27):
//  * here_title becomes "Your spot" (item 6: edit the row's text, no new row);
//  * closing_line becomes the walk's line (brief Part C).
// Each is changed only while the row still has its old text, so a later edit of
// Dana's is never reverted. The spot's rows (dial_spot_effect, dial_spot_event),
// the parameters and the new copy rows are seeded by schema.sql (insert if
// missing), so the spot exists from the boot that creates it; this script
// reads them back for the evidence and writes none of them.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapSpot_2026_11_26.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. Idempotent: a second run writes nothing.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapSpot_2026_11_26';

/** The two copy rows this brief changes: the text they must still have, and the new text. */
export const COPY: Array<{ code: string; from: string; to: string }> = [
  { code: 'here_title', from: 'You are here', to: 'Your spot' },
  {
    code: 'closing_line',
    from: 'Nothing moves until you choose. Your dot moves when you pick a bag.',
    to: 'Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it.',
  },
];

export type Action = 'write' | 'same' | 'kept';
export interface PlanRow { section: 'copy' | 'event' | 'parameter' | 'spot'; subject: string; now: string; next: string; action: Action }
export interface Plan { rows: PlanRow[] }

const show = (s: string | null) => (s === null ? '(none)' : `"${s}"`);

export async function planSpot(tx: Tx): Promise<Plan> {
  const rows: PlanRow[] = [];
  const copy = new Map((await tx.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(x => [x.code, x.text]));
  for (const c of COPY) {
    const now = copy.get(c.code) ?? null;
    if (now === null) throw new Error(`STOP: dial_customer_copy has no current ${c.code} row`);
    const action: Action = now === c.to ? 'same' : now === c.from ? 'write' : 'kept';
    rows.push({ section: 'copy', subject: c.code, now: show(now), next: action === 'kept' ? `${show(now)} (edited since; kept)` : show(c.to), action });
  }
  // Read back what the schema seeded (no write).
  const { spotEvents } = await import('../services/dialReads.js');
  for (const e of await spotEvents({}, tx)) {
    rows.push({ section: 'event', subject: e.code, now: `${e.effect_code}${e.is_active ? '' : ' (off)'} · ${e.trail_word ?? '(no trail word)'}`, next: 'as is', action: 'same' });
  }
  const { getParameters } = await import('../services/evidenceReads.js');
  const params = [...await getParameters('feedback_', tx), ...await getParameters('dial_spot_', tx)];
  for (const p of params) rows.push({ section: 'parameter', subject: p.key, now: String(p.value), next: 'as is', action: 'same' });
  const basis = (await tx.query<{ spot_event_code: string; n: number }>(
    `SELECT spot_event_code, count(*)::int AS n FROM v_customer_match_current GROUP BY 1 ORDER BY 1`)).rows;
  for (const b of basis) rows.push({ section: 'spot', subject: `spots set by ${b.spot_event_code}`, now: String(b.n), next: 'as is', action: 'same' });
  return { rows };
}

export interface ApplyResult { plan: Plan; written: number }

/** --apply inside the caller's transaction: exactly the plan's write rows, through setCustomerCopyInTx. */
export async function applySpot(tx: Tx): Promise<ApplyResult> {
  const { setCustomerCopyInTx } = await import('../services/dialPlacementService.js');
  const plan = await planSpot(tx);
  let written = 0;
  for (const r of plan.rows) {
    if (r.section !== 'copy' || r.action !== 'write') continue;
    const x = await setCustomerCopyInTx(tx, { code: r.subject, text: COPY.find(c => c.code === r.subject)!.to, adminUid: ACTOR });
    if (!x.unchanged) written++;
  }
  return { plan, written };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('kept')} kept (edited since).`);
  for (const s of ['copy', 'event', 'parameter', 'spot'] as const) {
    const rows = plan.rows.filter(r => r.section === s);
    out.push('', `## ${s} (${rows.filter(r => r.action === 'write').length} write)`, '', '| subject | now | next | action |', '|---|---|---|---|');
    for (const r of rows) out.push(`| ${r.subject} | ${r.now} | ${r.next} | ${r.action} |`);
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
        console.log(`# Ella map 14 spot, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planSpot(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const r = await withTransaction(tx => applySpot(tx));
    console.log(`# Ella map 14 spot, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written\n`);
    console.log(formatPlan(r.plan));
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
