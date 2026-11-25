// Usual Drink 2 (2026-11-24), Part C: takes_it becomes several choices. Each
// customer whose latest takes_it `set` row holds a single value gets one new
// row, `set [value]`, through record.brewProfileChange.backfill (source
// backfill, source_id ud2:takes_it:<user_id>), sorted directly after that row:
// occurred_at = its occurred_at + 1 microsecond, computed in SQL so the
// microseconds survive (Dana 2026-11-24, Task 0 answer 1), so the date the
// customer told us does not move; recorded_at = now. The selection reads the
// raw latest `set` row, not the folded value, so a customer Liam added to after
// that row is still converted and the later rows fold on top. A retired or
// unknown single value is reported and skipped: there is no mapping here
// (Dana 2026-11-24, Task 0 answer 3). Old rows are never updated or deleted
// (G2.20). Idempotent: once converted, the latest set is an array and the
// customer is not selected again; the source_id is unique besides.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_2_ROUTINE_AND_PROFILE.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/usualDrink2TakesIt_2026_11_24.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const FIELD = 'takes_it';
export const SOURCE_ID_PREFIX = 'ud2:takes_it:';

export interface TakesItRow {
  userId: string;
  setRowId: string;
  occurredAt: string;
  nextAt: string;
  value: unknown;
  action: 'convert' | 'skip';
  why?: string;
}

/** Read-only: every customer whose latest takes_it set row holds a single value, and what --apply does with it. */
export async function planTakesIt(tx: Tx): Promise<TakesItRow[]> {
  const { loadBrewProfileFields, getBrewProfileFieldsConfig } = await import('../services/brewProfile.js');
  await loadBrewProfileFields(tx);
  const cfg = getBrewProfileFieldsConfig()[FIELD];
  if (!cfg) throw new Error(`no ${FIELD} field row`);
  const { getLatestSingleValueSets } = await import('../services/customerReads.js');
  const { rows } = await getLatestSingleValueSets(FIELD, tx);
  return rows.map(row => {
    const value = JSON.parse(row.value) as unknown;
    const def = cfg.values.find(v => v.code === value);
    const base = { userId: row.userId, setRowId: row.id, occurredAt: row.occurredAt, nextAt: row.nextAt, value };
    if (!def) return { ...base, action: 'skip' as const, why: 'not a takes_it value' };
    if (!def.isActive) return { ...base, action: 'skip' as const, why: `retired value ${def.code}: reported, no mapping` };
    return { ...base, action: 'convert' as const };
  });
}

/** Writes the conversion rows in the caller's transaction; returns the plan and how many rows were inserted. */
export async function applyTakesIt(tx: Tx): Promise<{ plan: TakesItRow[]; written: number }> {
  const { record } = await import('../services/customerFacts.js');
  const plan = await planTakesIt(tx);
  const recordedAt = new Date();
  let written = 0;
  for (const p of plan) {
    if (p.action !== 'convert') continue;
    const r = await record.brewProfileChange.backfill({
      userId: p.userId, source: 'backfill', sourceId: `${SOURCE_ID_PREFIX}${p.userId}`,
      field: FIELD, op: 'set', value: JSON.stringify([p.value]),
      occurredAt: p.nextAt, recordedAt,
    }, tx);
    if (r.inserted) written++;
  }
  return { plan, written };
}

export function formatPlan(plan: TakesItRow[]): string {
  const out = [`${plan.filter(p => p.action === 'convert').length} to convert, ${plan.filter(p => p.action === 'skip').length} skipped`, '',
    '| user | latest set row | occurred_at | value | new row occurred_at | action |', '|---|---|---|---|---|---|'];
  for (const p of plan) out.push(`| ${p.userId} | ${p.setRowId} | ${p.occurredAt} | ${JSON.stringify(p.value)} | ${p.action === 'convert' ? p.nextAt : ''} | ${p.action}${p.why ? ` (${p.why})` : ''} |`);
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
  const { getLatestSingleValueSets } = await import('../services/customerReads.js');
  const count = async () => (await getLatestSingleValueSets(FIELD)).fieldRowCount;
  try {
    if (!apply) {
      const client = await db.connect();
      try {
        await client.query('BEGIN READ ONLY');
        console.log(`# Usual Drink 2 takes_it conversion, DRY RUN on ${cur} (${new Date().toISOString()}); ${FIELD} rows now: ${await count()}\n`);
        console.log(formatPlan(await planTakesIt(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const before = await count();
    const result = await withTransaction(tx => applyTakesIt(tx));
    console.log(`# Usual Drink 2 takes_it conversion, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} row(s) written; ${FIELD} rows ${before} -> ${await count()}\n`);
    console.log(formatPlan(result.plan));
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
