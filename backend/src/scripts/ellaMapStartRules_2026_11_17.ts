// Ella's Bloom Map 7 (2026-11-17), B6: enters the start rule (Data 1 of the
// brief, nine rows after Dana's answer 2 of 2026-11-17) through
// dialPlacementService.setStartRuleInTx, and retires the first-match picks
// that sit on a closed side (A2: v_dial_wedge_lane is_open false, Earthy and
// Floral toward each other) through setFirstMatchInTx's retire path.
// It does not publish: start rules are not versioned, they take effect when
// written, so the production write sits behind the brief's Part E STOP.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapStartRules_2026_11_17.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes everything in one transaction. Idempotent: a second run
// writes nothing. SAFETY: refuses unless the connected database is exactly
// --expect-db (default axisandbloom_test), checked from DATABASE_URL before
// connecting and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';
import { setStartRuleInTx, setFirstMatchInTx } from '../services/dialPlacementService.js';

export const ACTOR = 'script:ellaMapStartRules_2026_11_17';
export const NOTES = 'Data 1, Ella map 7 (Dana 2026-11-15 to 2026-11-17)';

export interface StartRuleData {
  family: string; priority: number; condition: string; also: string | null; coffee: string;
  adminLabel: string; customerReason: string;
}

/** Data 1 of the brief, without the dropped "dark, smoky" Chocolate & Nutty row (Dana 2026-11-17, answer 2). Coffee = the placed coffee's name. */
export const DATA_1: StartRuleData[] = [
  { family: 'balanced_sweet', priority: 1, condition: 'fruity_gt_cn', also: null, coffee: 'Colombia La Familia Guarnizo',
    adminLabel: 'Fruity points higher than Chocolate & Nutty points',
    customerReason: 'You like it gentle, and you are curious about something brighter. This one is sweet first, with a touch of fruit.' },
  { family: 'balanced_sweet', priority: 9, condition: 'always', also: null, coffee: 'Benchmark',
    adminLabel: 'Otherwise',
    customerReason: 'Your answers were gentle all the way through. This is the cup where nothing sticks out, and it works however you make it.' },
  { family: 'chocolate_nutty', priority: 2, condition: 'fruity_gt_balanced', also: 'espresso_at_home', coffee: 'Tiger Stripe Espresso',
    adminLabel: 'Fruity points higher than Balanced points, and makes espresso at home',
    customerReason: 'You like a stronger cup with a little lift, and you make espresso. This one was built for it.' },
  { family: 'chocolate_nutty', priority: 3, condition: 'fruity_gt_balanced', also: null, coffee: 'Fabricator House Roast',
    adminLabel: 'Fruity points higher than Balanced points',
    customerReason: 'You asked for a stronger cup and picked one bright answer. This is chocolate and nut first, with a little lift.' },
  { family: 'chocolate_nutty', priority: 9, condition: 'always', also: null, coffee: 'The Daily',
    adminLabel: 'Otherwise',
    customerReason: 'You like chocolate with some strength. This is the everyday cup, a step bolder than the gentlest one.' },
  { family: 'earthy', priority: 9, condition: 'always', also: null, coffee: 'Amsterdam',
    adminLabel: 'Always',
    customerReason: 'You asked for dark and strong. This one is deep and smooth, with dark chocolate and walnut.' },
  { family: 'fruity', priority: 1, condition: 'cn_gt_zero', also: null, coffee: 'Geometric Filter Coffee',
    adminLabel: 'Any Chocolate & Nutty points',
    customerReason: 'You want fruit, with something underneath it. This one is bright fruit over caramel.' },
  { family: 'fruity', priority: 9, condition: 'always', also: null, coffee: 'Cafè Feminista: Montze Olvera',
    adminLabel: 'Otherwise',
    customerReason: 'You went for fruit all the way. This one is soft and tropical, with papaya and candied coconut.' },
  { family: 'floral', priority: 9, condition: 'always', also: null, coffee: 'The Village',
    adminLabel: 'Always',
    customerReason: 'You like it delicate and bright. This one is floral, with apple blossom and grapefruit.' },
];

/**
 * The pair the schema closes on its first boot (dial_seam.is_open, A1). Read
 * only by a dry run against a database that does not have the Ella map 7
 * objects yet (production before the deploy); once deployed, the closed sides
 * come from v_dial_wedge_lane.
 */
export const CLOSED_PAIR_ON_DEPLOY: [string, string] = ['earthy', 'floral'];

export interface PlanRow { section: 'start_rule' | 'first_match'; subject: string; now: string; next: string; action: 'write' | 'unchanged' | 'retire' | 'missing' }
export interface Plan { rows: PlanRow[]; missing: string[]; extra: string[]; deployed: boolean }

async function placedCoffee(tx: Tx, name: string): Promise<{ id: number; name: string } | null> {
  const r = await tx.query<{ coffee_id: number; coffee_name: string }>(`SELECT coffee_id, coffee_name FROM v_dial_placement WHERE coffee_name = $1`, [name]);
  return r.rows.length === 1 ? { id: r.rows[0].coffee_id, name: r.rows[0].coffee_name } : null;
}

const describe = (r: { condition: string; also: string | null; coffee: string; adminLabel: string }) =>
  `${r.condition}${r.also ? ` + ${r.also}` : ''} -> ${r.coffee} ("${r.adminLabel}")`;

/** What --apply would write, fact by fact. Reads only. */
export async function planStartRules(tx: Tx, data: StartRuleData[] = DATA_1): Promise<Plan> {
  const rows: PlanRow[] = [];
  const missing: string[] = [];
  const deployed = (await tx.query<{ ok: boolean }>(`SELECT to_regclass('public.v_dial_start_rule') IS NOT NULL AND to_regclass('public.v_dial_wedge_lane') IS NOT NULL AS ok`)).rows[0].ok;
  const current = !deployed ? [] : (await tx.query<{ family_code: string; priority: number; condition_code: string; also_condition_code: string | null; coffee_id: number; coffee_name: string; admin_label: string; customer_reason: string; notes: string | null }>(
    `SELECT family_code, priority, condition_code, also_condition_code, coffee_id, coffee_name, admin_label, customer_reason, notes
       FROM v_dial_start_rule WHERE is_current`)).rows;
  for (const d of data) {
    const subject = `${d.family} #${d.priority}`;
    const coffee = await placedCoffee(tx, d.coffee);
    const cur = current.find(c => c.family_code === d.family && Number(c.priority) === d.priority);
    const now = cur ? describe({ condition: cur.condition_code, also: cur.also_condition_code, coffee: cur.coffee_name, adminLabel: cur.admin_label }) : '(none)';
    if (!coffee) { missing.push(`${subject}: ${d.coffee} is not placed on the active map`); rows.push({ section: 'start_rule', subject, now, next: describe(d), action: 'missing' }); continue; }
    const same = cur && cur.condition_code === d.condition && (cur.also_condition_code ?? null) === d.also && cur.coffee_id === coffee.id
      && cur.admin_label === d.adminLabel && cur.customer_reason === d.customerReason && (cur.notes ?? null) === NOTES;
    rows.push({ section: 'start_rule', subject, now, next: describe(d), action: same ? 'unchanged' : 'write' });
  }
  const extra = current.filter(c => !data.some(d => d.family === c.family_code && d.priority === Number(c.priority)))
    .map(c => `${c.family_code} #${c.priority}: ${c.coffee_name}`);
  // A2: the first-match picks on a closed side
  const closed = deployed
    ? (await tx.query<{ archetype_code: string; lane_code: string; toward_archetype: string }>(
        `SELECT archetype_code::text AS archetype_code, lane_code, toward_archetype::text AS toward_archetype FROM v_dial_wedge_lane WHERE NOT is_open ORDER BY archetype_code, lane_code`)).rows
    : (await tx.query<{ archetype_code: string; lane_code: string; toward_archetype: string }>(
        `SELECT w.archetype_code::text AS archetype_code, l.code AS lane_code,
                CASE l.code WHEN 'side_a' THEN w.side_a_archetype WHEN 'side_b' THEN w.side_b_archetype END::text AS toward_archetype
           FROM dial_wedge w CROSS JOIN dial_lane l
          WHERE (w.archetype_code::text = $1 AND CASE l.code WHEN 'side_a' THEN w.side_a_archetype WHEN 'side_b' THEN w.side_b_archetype END::text = $2)
             OR (w.archetype_code::text = $2 AND CASE l.code WHEN 'side_a' THEN w.side_a_archetype WHEN 'side_b' THEN w.side_b_archetype END::text = $1)
          ORDER BY 1, 2`, CLOSED_PAIR_ON_DEPLOY)).rows;
  for (const c of closed) {
    const fm = (await tx.query<{ coffee_name: string }>(
      `SELECT c.name AS coffee_name FROM dial_first_match fm JOIN dial_lane l ON l.id = fm.lane_id JOIN coffees c ON c.id = fm.coffee_id
        WHERE fm.archetype_code::text = $1 AND l.code = $2 AND fm.superseded_at IS NULL`, [c.archetype_code, c.lane_code])).rows[0];
    rows.push({ section: 'first_match', subject: `${c.archetype_code} ${c.lane_code} (toward ${c.toward_archetype}, closed)`,
      now: fm ? fm.coffee_name : '(none)', next: '(retired)', action: fm ? 'retire' : 'unchanged' });
  }
  return { rows, missing, extra, deployed };
}

export interface ApplyResult { plan: Plan; written: number }

/** Writes the plan in the caller's transaction; refuses when a Data 1 coffee is not placed. */
export async function applyStartRules(tx: Tx, data: StartRuleData[] = DATA_1): Promise<ApplyResult> {
  const plan = await planStartRules(tx, data);
  if (!plan.deployed) throw new Error('Not applied: the Ella map 7 schema is not on this database yet (deploy first).');
  if (plan.missing.length) throw new Error(`Not applied: ${plan.missing.join('; ')}`);
  let written = 0;
  for (const d of data) {
    const coffee = (await placedCoffee(tx, d.coffee))!;
    const r = await setStartRuleInTx(tx, {
      familyCode: d.family, priority: d.priority, conditionCode: d.condition, alsoConditionCode: d.also,
      coffeeId: coffee.id, adminLabel: d.adminLabel, customerReason: d.customerReason, notes: NOTES, adminUid: ACTOR,
    });
    if (!r.unchanged) written++;
  }
  for (const row of plan.rows.filter(r => r.section === 'first_match' && r.action === 'retire')) {
    const [archetypeCode, laneCode] = row.subject.split(' ');
    const r = await setFirstMatchInTx(tx, { archetypeCode, laneCode, coffeeId: 0, retire: true, adminUid: ACTOR });
    if (r.retired) written++;
  }
  return { plan, written };
}

export function formatPlan(plan: Plan): string {
  const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|');
  const count = (a: PlanRow['action']) => plan.rows.filter(r => r.action === a).length;
  const out = [`Plan: ${count('write')} write, ${count('retire')} retire, ${count('unchanged')} unchanged, ${count('missing')} missing.`, ''];
  if (!plan.deployed) out.push('The Ella map 7 schema is not on this database yet: no start rule exists, and the closed sides are the ones the schema closes on its first boot.', '');
  out.push('| section | subject | now | next | action |', '|---|---|---|---|---|');
  for (const r of plan.rows) out.push(`| ${esc(r.section)} | ${esc(r.subject)} | ${esc(r.now)} | ${esc(r.next)} | ${esc(r.action)} |`);
  if (plan.missing.length) out.push('', 'Missing:', ...plan.missing.map(m => `- ${m}`));
  if (plan.extra.length) out.push('', 'Current rows not in Data 1 (left as they are):', ...plan.extra.map(m => `- ${m}`));
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
        console.log(`# Ella map 7 start rules, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planStartRules(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const result = await withTransaction(tx => applyStartRules(tx));
    console.log(`# Ella map 7 start rules, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} row(s) written\n`);
    console.log(formatPlan(result.plan));
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
