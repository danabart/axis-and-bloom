// Ella's Bloom Map 13 (2026-11-26), Part A: the /map panel in the roaster's terms.
// Enters, through the writers only, what Dana decided at the Task 0 STOP (2026-11-26):
//  * the panel's five headings as dial_customer_copy rows (setCustomerCopyInTx;
//    the schema seeds the same if missing): where_it_shines, roaster_rates,
//    roaster_rates_caption, roaster_words_title, notes_title, notes_heading;
//  * Mouthfeel held back for every roaster with a coffee on the map
//    (roasteryPortalService.setDimensionHoldInTx; call 4): the roaster's
//    answers are never touched (G2.20).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_13_LAPTOP_LAYOUT_AND_ROASTER_PROFILE.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapRoasterProfile_2026_11_26.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. Idempotent: a second run writes nothing.
// Every read goes through a view or roasteryPortalReads. Roasters are found
// from the map (the catalog roaster of each placed coffee), dimensions by their
// portal label; no roaster name or id is written here.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapRoasterProfile_2026_11_26';

export const COPY: Array<{ code: string; text: string }> = [
  { code: 'where_it_shines', text: 'Where it shines' },
  { code: 'roaster_rates', text: 'How the roaster rates it' },
  { code: 'roaster_rates_caption', text: 'Rated by the roaster, against their own coffees.' },
  { code: 'roaster_words_title', text: 'In the roaster’s words' },
  { code: 'notes_title', text: 'See the notes wheel' },
  { code: 'notes_heading', text: 'Notes' }, // fix (Dana 2026-11-26): the notes as a plain line under this heading
];

/** Held back for every roaster with a coffee on the map (Dana, call 4). */
export const HOLDS: Array<{ dimensionLabel: string; reason: string }> = [
  {
    dimensionLabel: 'Mouthfeel',
    reason: 'Ella map 13 (Dana 2026-11-26): Silky to Grippy cannot be checked against our cupping (no Texture numbers), and the roaster\'s Mouthfeel follows their own Body, so its high end reads as fuller, not grippy. Held back until it can be checked.',
  },
];

export type Action = 'write' | 'same';
export interface PlanRow { section: 'copy' | 'hold'; subject: string; now: string; next: string; action: Action; roasterId?: string; dimensionId?: number; reason?: string }
export interface Plan { rows: PlanRow[] }

const show = (s: string | null) => (s === null ? '(none)' : `"${s}"`);

/** The roasters of the coffees on the active map (the catalog's roaster of each placed coffee). */
async function mapRoasters(tx: Tx): Promise<Array<{ roaster_id: string; n: number }>> {
  return (await tx.query<{ roaster_id: string; n: number }>(
    `SELECT vc.roaster_id, count(DISTINCT p.coffee_id)::int AS n
       FROM v_dial_placement p
       JOIN v_coffee vc ON vc.id = p.coffee_id
      WHERE vc.roaster_id IS NOT NULL
      GROUP BY vc.roaster_id ORDER BY vc.roaster_id`)).rows;
}

export async function planRoasterProfile(tx: Tx): Promise<Plan> {
  const { getVocabulary, listDimensionHolds } = await import('../services/roasteryPortalReads.js');
  const rows: PlanRow[] = [];
  const copy = new Map((await tx.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(x => [x.code, x.text]));
  for (const d of COPY) {
    const now = copy.get(d.code) ?? null;
    rows.push({ section: 'copy', subject: d.code, now: show(now), next: show(d.text), action: now === d.text ? 'same' : 'write' });
  }
  const roasters = await mapRoasters(tx);
  if (!roasters.length) throw new Error('STOP: no roaster has a coffee on the map');
  const dims = (await getVocabulary({ fresh: true })).dimensions;
  for (const h of HOLDS) {
    const dim = dims.filter(d => d.label === h.dimensionLabel);
    if (dim.length !== 1) throw new Error(`STOP: ${dim.length} active portal dimensions labelled '${h.dimensionLabel}'`);
    const dimensionId = dim[0].dimensionId;
    for (const r of roasters) {
      const open = (await listDimensionHolds(r.roaster_id, tx)).find(x => x.dimensionId === dimensionId && x.isOpen);
      rows.push({
        section: 'hold', subject: `${h.dimensionLabel} · the roaster of ${r.n} map coffee(s)`,
        now: open ? `held (#${open.id})` : 'shown', next: 'held', action: open ? 'same' : 'write',
        roasterId: r.roaster_id, dimensionId, reason: h.reason,
      });
    }
  }
  return { rows };
}

export interface ApplyResult { plan: Plan; written: number }

/** --apply inside the caller's transaction: exactly the plan's write rows, through the writers. */
export async function applyRoasterProfile(tx: Tx): Promise<ApplyResult> {
  const { setCustomerCopyInTx } = await import('../services/dialPlacementService.js');
  const { setDimensionHoldInTx } = await import('../services/roasteryPortalService.js');
  const plan = await planRoasterProfile(tx);
  let written = 0;
  for (const r of plan.rows) {
    if (r.action !== 'write') continue;
    if (r.section === 'copy') {
      await setCustomerCopyInTx(tx, { code: r.subject, text: COPY.find(c => c.code === r.subject)!.text, adminUid: ACTOR });
      written++;
    } else {
      const x = await setDimensionHoldInTx(tx, { roasterId: r.roasterId, dimensionId: r.dimensionId, hold: true, reason: r.reason, actorUid: ACTOR });
      if (!x.unchanged) written++;
    }
  }
  return { plan, written };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged.`);
  for (const s of ['copy', 'hold'] as const) {
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
        console.log(`# Ella map 13 roaster profile, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planRoasterProfile(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const r = await withTransaction(tx => applyRoasterProfile(tx));
    console.log(`# Ella map 13 roaster profile, APPLIED on ${cur} (${new Date().toISOString()}): ${r.written} row(s) written\n`);
    console.log(formatPlan(r.plan));
  } finally { await db.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
