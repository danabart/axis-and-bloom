// Ella's Bloom Map 8 (2026-11-18), B3: makes every map coffee buyable at one
// price list, through catalogService only:
//   - a 12 oz SKU for each map coffee that has none (upsertSku: cost NULL, code minted);
//   - coffee_retail_price at 12 oz for all 18 (Data 1; Tiger Stripe and The
//     Village $32.00, Dana 2026-11-18 answer 1);
//   - the seven short names of Data 2 (updateCoffee shortName, answer 5);
//   - 2 lb and 5 lb switched off (setSizeActive, answer 4).
// No slot price changes (answer 3). It writes no 2 lb or 5 lb price and deletes nothing.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_8_PRICES_AND_BUYABLE.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapPrices_2026_11_18.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes everything in one transaction through the catalogService
// InTx verbs (each write logged in catalog_change), then plans again inside
// it. Idempotent: a
// second run writes nothing. Coffees are found by name among the active
// coffees on the active map (their ids differ between databases). SAFETY:
// refuses unless the connected database is exactly --expect-db (default
// axisandbloom_test), checked from DATABASE_URL before connecting and from
// current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapPrices_2026_11_18';
export const WEIGHT_OZ = 12;

/** Data 1: the 12 oz retail price per map coffee, in cents. */
export const DATA_1: Array<{ name: string; cents: number }> = [
  { name: 'Benchmark', cents: 2900 },
  { name: 'Half Moon (Half Caff)', cents: 2900 },
  { name: 'The Daily', cents: 2900 },
  { name: 'Brazil', cents: 2900 },
  { name: 'Fabricator House Roast', cents: 2900 },
  { name: 'Blossom Dark Roast', cents: 2900 },
  { name: 'The Waverly', cents: 2900 },
  { name: 'Nightcap Decaf', cents: 2900 },
  { name: 'Amsterdam', cents: 2900 },
  { name: 'Great Heights', cents: 2900 },
  { name: 'Big City', cents: 2900 },
  { name: 'Indonesia', cents: 2900 },
  { name: 'Geometric Filter Coffee', cents: 2900 },
  { name: 'Colombia La Familia Guarnizo', cents: 2900 },
  { name: 'D.R. Congo', cents: 2900 },
  { name: 'Cafè Feminista: Montze Olvera', cents: 2900 },
  { name: 'Tiger Stripe Espresso', cents: 3200 },
  { name: 'The Village', cents: 3200 },
];

/** Data 2: short names (the other eleven keep their name). */
export const DATA_2: Array<{ name: string; shortName: string }> = [
  { name: 'Fabricator House Roast', shortName: 'Fabricator' },
  { name: 'Tiger Stripe Espresso', shortName: 'Tiger Stripe' },
  { name: 'Blossom Dark Roast', shortName: 'Blossom' },
  { name: 'Geometric Filter Coffee', shortName: 'Geometric' },
  { name: 'Colombia La Familia Guarnizo', shortName: 'La Familia' },
  { name: 'Cafè Feminista: Montze Olvera', shortName: 'Cafè Feminista' },
  { name: 'Half Moon (Half Caff)', shortName: 'Half Moon' },
];

/** The sizes switched off (answer 4). */
export const SIZES_OFF = [32, 80];

export interface PlanRow { section: 'sku' | 'retail price' | 'short name' | 'size'; subject: string; now: string; next: string; action: 'write' | 'unchanged' }
export interface Plan {
  rows: PlanRow[];
  missing: string[];
  writes: { sku: number[]; price: Array<{ coffeeId: number; cents: number }>; shortName: Array<{ coffeeId: number; shortName: string }>; sizesOff: number[] };
  /** a map coffee's winning 12 oz slot price that will not equal its retail price (integrity check 15) */
  slotDisagree: string[];
}

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? 'none' : `$${(c / 100).toFixed(2)}`);

export async function planPrices(tx: Tx): Promise<Plan> {
  // A database without this brief's schema yet (production before the deploy) has no short_name: read it as none.
  const hasShort = Boolean((await tx.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'v_coffee' AND column_name = 'short_name'`)).rowCount);
  const map = (await tx.query<{ id: number; name: string; short_name: string | null; roaster_name: string }>(
    `SELECT c.id, c.name, ${hasShort ? 'c.short_name' : 'NULL::text AS short_name'}, c.roaster_name FROM v_coffee c
      WHERE c.is_active AND c.id IN (SELECT coffee_id FROM v_dial_placement)`)).rows;
  const byName = new Map<string, typeof map>();
  for (const c of map) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  const plan: Plan = { rows: [], missing: [], writes: { sku: [], price: [], shortName: [], sizesOff: [] }, slotDisagree: [] };
  const one = (name: string) => {
    const hits = byName.get(name) ?? [];
    if (hits.length !== 1) { plan.missing.push(`${name}: ${hits.length} active coffees on the map with this name`); return null; }
    return hits[0];
  };
  const named = new Set([...DATA_1.map(d => d.name)]);
  for (const c of map) if (!named.has(c.name)) plan.missing.push(`${c.name} (coffee ${c.id}) is on the map but not in Data 1`);

  for (const d of DATA_1) {
    const c = one(d.name);
    if (!c) continue;
    const sku = (await tx.query<{ roaster_sku: string | null }>(
      `SELECT roaster_sku FROM coffee_sku WHERE coffee_id = $1 AND weight_oz = $2 AND is_active`, [c.id, WEIGHT_OZ])).rows[0];
    plan.rows.push({ section: 'sku', subject: `${c.name} (${c.roaster_name})`, now: sku ? `12 oz ${sku.roaster_sku ?? '(no code)'}` : 'none',
      next: sku ? 'as is' : '12 oz, cost none, code minted', action: sku ? 'unchanged' : 'write' });
    if (!sku) plan.writes.sku.push(c.id);

    const price = (await tx.query<{ retail_price_cents: number }>(
      `SELECT retail_price_cents FROM coffee_retail_price WHERE coffee_id = $1 AND weight_oz = $2`, [c.id, WEIGHT_OZ])).rows[0];
    const same = price?.retail_price_cents === d.cents;
    plan.rows.push({ section: 'retail price', subject: c.name, now: dollars(price?.retail_price_cents), next: dollars(d.cents), action: same ? 'unchanged' : 'write' });
    if (!same) plan.writes.price.push({ coffeeId: c.id, cents: d.cents });

    const win = (await tx.query<{ slot_name: string; retail_price_cents: number }>(
      `SELECT slot_name, retail_price_cents FROM v_coffee_sellable_slot WHERE coffee_id = $1 AND weight_oz = $2`, [c.id, WEIGHT_OZ])).rows;
    for (const w of win) if (w.retail_price_cents !== d.cents) plan.slotDisagree.push(`${c.name}: wins "${w.slot_name}" at ${dollars(w.retail_price_cents)}, retail ${dollars(d.cents)}`);
  }

  for (const d of DATA_2) {
    const c = one(d.name);
    if (!c) continue;
    const same = c.short_name === d.shortName;
    plan.rows.push({ section: 'short name', subject: c.name, now: c.short_name ?? 'none', next: d.shortName, action: same ? 'unchanged' : 'write' });
    if (!same) plan.writes.shortName.push({ coffeeId: c.id, shortName: d.shortName });
  }

  for (const oz of SIZES_OFF) {
    const sz = (await tx.query<{ label: string; is_active: boolean; is_anchor: boolean }>(
      `SELECT label, is_active, is_anchor FROM coffee_size WHERE weight_oz = $1`, [oz])).rows[0];
    if (!sz) { plan.missing.push(`size ${oz} oz is not a coffee_size row`); continue; }
    if (sz.is_anchor) { plan.missing.push(`size ${sz.label} is the anchor; not switched off`); continue; }
    plan.rows.push({ section: 'size', subject: sz.label, now: sz.is_active ? 'on' : 'off', next: 'off', action: sz.is_active ? 'write' : 'unchanged' });
    if (sz.is_active) plan.writes.sizesOff.push(oz);
  }
  return plan;
}

export interface ApplyResult { written: number; plan: Plan; after: Plan }

/** Plans, then applies in the caller's transaction through the catalogService InTx verbs, then plans again. */
export async function applyPrices(tx: Tx): Promise<ApplyResult> {
  const plan = await planPrices(tx);
  if (plan.missing.length) throw new Error(`refusing to apply with missing rows:\n- ${plan.missing.join('\n- ')}`);
  const svc = await import('../services/catalogService.js');
  const ctx = { actor: ACTOR };
  let written = 0;
  for (const coffeeId of plan.writes.sku) {
    const { blendId, before } = await svc.upsertSkuInTx(tx, { coffeeId, weightOz: WEIGHT_OZ });
    const after = await svc.snapshotRow(tx, 'coffee_sku', 'id', blendId);
    await svc.logCatalogChange(tx, { entity: 'sku', entityId: blendId, action: 'upsertSku', before, after, changedBy: ACTOR });
    written++;
  }
  for (const p of plan.writes.price) { await svc.setCoffeeRetailPriceInTx(tx, { coffeeId: p.coffeeId, weightOz: WEIGHT_OZ, retailPriceCents: p.cents }, ctx); written++; }
  for (const s of plan.writes.shortName) {
    const { before, after } = await svc.updateCoffeeInTx(tx, { coffeeId: s.coffeeId, shortName: s.shortName });
    await svc.logCatalogChange(tx, { entity: 'coffee', entityId: s.coffeeId, action: 'updateCoffee', before, after, changedBy: ACTOR });
    written++;
  }
  for (const oz of plan.writes.sizesOff) { await svc.setSizeActiveInTx(tx, { weightOz: oz, isActive: false }, ctx); written++; }
  return { written, plan, after: await planPrices(tx) };
}

export function formatPlan(plan: Plan): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const count = (a: PlanRow['action']) => plan.rows.filter(r => r.action === a).length;
  const out = [`**${count('write')} write, ${count('unchanged')} unchanged, ${plan.missing.length} missing**`, ''];
  out.push('| section | subject | now | next | action |', '|---|---|---|---|---|');
  for (const r of plan.rows) out.push(`| ${esc(r.section)} | ${esc(r.subject)} | ${esc(r.now)} | ${esc(r.next)} | ${esc(r.action)} |`);
  if (plan.missing.length) out.push('', 'Missing:', ...plan.missing.map(m => `- ${m}`));
  out.push('', plan.slotDisagree.length
    ? `Winning slot prices that will disagree with the retail price (check 15):\n${plan.slotDisagree.map(m => `- ${m}`).join('\n')}`
    : 'Winning slot prices: every map coffee that wins a slot at 12 oz wins it at its retail price (check 15 clean).');
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
  const readOnlyPlan = async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN READ ONLY');
      return await planPrices(client as unknown as Tx);
    } finally { await client.query('ROLLBACK'); client.release(); }
  };
  try {
    const plan = await readOnlyPlan();
    if (!apply) {
      console.log(`# Ella map 8 prices, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
      console.log(formatPlan(plan));
      return;
    }
    const result = await withTransaction(tx => applyPrices(tx));
    (await import('../services/catalogReads.js')).clearSizeCache();
    console.log(`# Ella map 8 prices, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} write(s)\n`);
    console.log(formatPlan(result.plan));
    console.log(`\n## After\n\n${formatPlan(result.after)}`);
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
