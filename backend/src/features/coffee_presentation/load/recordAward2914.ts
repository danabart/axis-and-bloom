// Coffee presentation brief 1 (2026-10-23), decision 7 / D1 — the one evidence
// row this brief adds: Tiger Stripe's (coffee 2914) award as a roastery_remark
// of topic 'award', written through the remark writer
// (roasteryRemarkService.recordRemarks), never inline SQL. The existing
// 'general' remark that names the award stays as it is (insert-only). The new
// row takes that row's capture date and channel and names it in record_source.
// Idempotent: a current award row with the same coffee and words means nothing
// is written. A TS writer cannot run from schema.sql, so this is a one-off
// loader run once per database instead of a boot seed.
//
//   npx tsx src/features/coffee_presentation/load/recordAward2914.ts --expect-db <db> [--dry-run]
//
// DATABASE_URL must be set in the shell before this runs (dotenv does not
// override it) and must name --expect-db.
import 'dotenv/config';
import { db } from '../../../db/client.js';
import { listRemarks } from '../../../services/roasteryRemarkReads.js';
import { recordRemarks } from '../../../services/roasteryRemarkService.js';

const COFFEE_ID = 2914;
const AWARD = '2023 Golden Bean medal';
const SOURCE_REMARK = 'Winner of a 2023 Golden Bean medal, this classic espresso blend';
const BRIEF = 'coffee presentation brief 1';

const args = process.argv.slice(2);
const expectDb = args[args.indexOf('--expect-db') + 1];
const dryRun = args.includes('--dry-run');

async function main() {
  if (!args.includes('--expect-db') || !expectDb) throw new Error('pass --expect-db <database name>');
  const current = (await db.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
  if (current !== expectDb) throw new Error(`connected to '${current}', expected '${expectDb}'`);

  const remarks = await listRemarks({ coffeeId: COFFEE_ID, currentOnly: true });
  const existing = remarks.find((r: any) => r.topic === 'award' && r.remark === AWARD);
  if (existing) {
    console.log(`[${current}] award row already present (${existing.id}); nothing written`);
    return;
  }
  const source = remarks.find((r: any) => r.topic === 'general' && r.remark === SOURCE_REMARK);
  if (!source) throw new Error(`[${current}] the general remark naming the award was not found for coffee ${COFFEE_ID}`);
  const saidOn = (source.said_on instanceof Date ? source.said_on.toISOString() : String(source.said_on)).slice(0, 10);

  const input = {
    roasterId: source.roaster_id, coffeeId: COFFEE_ID, portalCoffeeId: source.portal_coffee_id ?? null,
    saidBy: source.said_by, saidOn, channel: source.channel, topic: 'award' as const, remark: AWARD,
    recordedBy: BRIEF, recordSource: `roastery_remark ${source.id} (general, ${source.channel} ${saidOn}); ${BRIEF}`,
  };
  console.log(`[${current}] ${dryRun ? 'would write' : 'writing'}:`, input);
  if (dryRun) return;
  const [row] = await recordRemarks([input], { actor: BRIEF });
  console.log(`[${current}] award row written: ${row.id}`);
}

main().then(() => db.end()).catch(async err => { console.error(err); await db.end(); process.exit(1); });
