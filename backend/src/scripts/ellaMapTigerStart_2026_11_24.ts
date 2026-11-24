// Ella's Bloom Map 11 (2026-11-24): Tiger Stripe Espresso becomes the first
// bag for Chocolate & Nutty leaning fruity (no espresso answer). One start
// rule row, entered through dialPlacementService.setStartRuleInTx, which
// supersedes the current row and inserts the new one (G2.11: nothing is
// deleted). Family, priority, condition, admin label and notes stay as they
// are; only the coffee, its sentences and its lead change (decisions 1 and 2).
// Start rules are not versioned, so nothing is published.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_11_TIGER_STRIPE_START.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapTigerStart_2026_11_24.ts [--dry-run | --apply] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction).
// --apply writes in one transaction. Idempotent: a second run writes nothing.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after. Reads only views; writes only through
// the service.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';
import { setStartRuleInTx } from '../services/dialPlacementService.js';

export const ACTOR = 'script:ellaMapTigerStart_2026_11_24';

/** Decisions 1 and 2 of the brief (Dana 2026-11-24). Coffees are resolved by roaster and name. */
export const RULE = {
  family: 'chocolate_nutty', priority: 3, condition: 'fruity_gt_balanced', also: null as string | null,
  roaster: 'Joe Bean Roasters',
  fromCoffee: 'Fabricator House Roast',
  coffee: 'Tiger Stripe Espresso',
  customerReason: 'You asked for a stronger cup and picked one bright answer. This is chocolate first, with a little lift.',
  coffeeLine: 'This one is chocolate first with a little lift, and it holds up however you brew it.',
  lead: 'Geometric Filter Coffee',
  leadLine: 'More fruit, and sweeter.',
};
export type RuleData = typeof RULE;

interface RuleRow {
  id: number; family_code: string; priority: number; condition_code: string; also_condition_code: string | null;
  coffee_id: number; coffee_name: string; admin_label: string; customer_reason: string; notes: string | null;
  coffee_line: string | null; lead_to_coffee_id: number | null; lead_to_coffee_name: string | null; lead_line: string | null;
  lead_quote_family_code: string | null; decided_by: string | null;
}
const RULE_COLS = `id, family_code, priority, condition_code, also_condition_code, coffee_id, coffee_name, admin_label, customer_reason, notes,
  coffee_line, lead_to_coffee_id, lead_to_coffee_name, lead_line, lead_quote_family_code, decided_by`;

export async function currentRules(tx: Tx): Promise<RuleRow[]> {
  return (await tx.query<RuleRow>(`SELECT ${RULE_COLS} FROM v_dial_start_rule WHERE is_current ORDER BY family_order, priority, id`)).rows;
}

/** Exactly one active catalog coffee of this roaster and name, else null. */
async function activeCoffee(tx: Tx, roaster: string, name: string): Promise<{ id: number; name: string } | null> {
  const r = await tx.query<{ id: number; name: string }>(
    `SELECT id, name FROM v_coffee WHERE is_active AND roaster_name = $1 AND name = $2`, [roaster, name]);
  return r.rows.length === 1 ? r.rows[0] : null;
}

export interface Plan {
  current: RuleRow | null; problems: string[]; action: 'write' | 'unchanged' | 'refuse';
  coffeeId: number | null; leadId: number | null; next: Record<string, string | null>;
  startsOnRule: number; fabricatorDecisions: Array<{ move_code: string; n: number }>;
}

/** What --apply would write. Reads only. */
export async function planTigerStart(tx: Tx, d: RuleData = RULE): Promise<Plan> {
  const problems: string[] = [];
  const rules = await currentRules(tx);
  const cur = rules.find(r => r.family_code === d.family && Number(r.priority) === d.priority) ?? null;
  const coffee = await activeCoffee(tx, d.roaster, d.coffee);
  const from = await activeCoffee(tx, d.roaster, d.fromCoffee);
  const lead = await activeCoffee(tx, d.roaster, d.lead);
  if (!coffee) problems.push(`${d.coffee} (${d.roaster}) is not exactly one active coffee`);
  if (!from) problems.push(`${d.fromCoffee} (${d.roaster}) is not exactly one active coffee`);
  if (!lead) problems.push(`${d.lead} (${d.roaster}) is not exactly one active coffee`);
  if (!cur) problems.push(`no current rule ${d.family} #${d.priority}`);
  else {
    if (cur.condition_code !== d.condition || (cur.also_condition_code ?? null) !== d.also)
      problems.push(`${d.family} #${d.priority} has condition ${cur.condition_code}${cur.also_condition_code ? ` + ${cur.also_condition_code}` : ''}, expected ${d.condition}${d.also ? ` + ${d.also}` : ''}`);
    if (coffee && from && cur.coffee_id !== from.id && cur.coffee_id !== coffee.id)
      problems.push(`${d.family} #${d.priority} gives ${cur.coffee_name}, expected ${d.fromCoffee} (or ${d.coffee} once applied)`);
  }
  if (coffee) {
    const placed = await tx.query(`SELECT 1 FROM v_dial_placement WHERE coffee_id = $1`, [coffee.id]);
    if (!placed.rows[0]) problems.push(`${d.coffee} is not placed on the active map`);
    if (lead) {
      const step = await tx.query(`SELECT 1 FROM v_dial_step WHERE is_current AND is_shown AND from_coffee_id = $1 AND to_coffee_id = $2`, [coffee.id, lead.id]);
      if (!step.rows[0]) problems.push(`${d.lead} is not a shown step from ${d.coffee}`);
    }
  }
  const same = !!cur && !!coffee && !!lead && cur.coffee_id === coffee.id && cur.customer_reason === d.customerReason
    && cur.coffee_line === d.coffeeLine && cur.lead_to_coffee_id === lead.id && cur.lead_line === d.leadLine;
  const startsOnRule = cur ? Number((await tx.query<{ n: string }>(
    `SELECT count(*) AS n FROM v_customer_quiz_current q JOIN v_dial_start s ON s.quiz_session_id = q.quiz_session_id WHERE s.rule_id = $1`, [cur.id])).rows[0].n) : 0;
  const fabricatorDecisions = from ? (await tx.query<{ move_code: string; n: number }>(
    `SELECT move_code, count(*)::int AS n FROM v_customer_match_trail WHERE picked_coffee_id = $1 GROUP BY 1 ORDER BY 1`, [from.id])).rows : [];
  return {
    current: cur, problems, action: problems.length ? 'refuse' : same ? 'unchanged' : 'write',
    coffeeId: coffee?.id ?? null, leadId: lead?.id ?? null,
    next: { coffee: d.coffee, customer_reason: d.customerReason, coffee_line: d.coffeeLine, lead: d.lead, lead_line: d.leadLine },
    startsOnRule, fabricatorDecisions,
  };
}

export interface ApplyResult { plan: Plan; written: number; newId: number | null; supersededId: number | null; othersUnchanged: boolean }

/** Writes the plan in the caller's transaction; refuses on any problem, and if any other current rule changed. */
export async function applyTigerStart(tx: Tx, d: RuleData = RULE): Promise<ApplyResult> {
  const plan = await planTigerStart(tx, d);
  if (plan.action === 'refuse') throw new Error(`Not applied: ${plan.problems.join('; ')}`);
  const before = (await currentRules(tx)).filter(r => r.id !== plan.current!.id);
  if (plan.action === 'unchanged') return { plan, written: 0, newId: plan.current!.id, supersededId: null, othersUnchanged: true };
  const cur = plan.current!;
  const r = await setStartRuleInTx(tx, {
    familyCode: d.family, priority: d.priority, conditionCode: d.condition, alsoConditionCode: d.also,
    coffeeId: plan.coffeeId!, adminLabel: cur.admin_label, customerReason: d.customerReason, notes: cur.notes, adminUid: ACTOR,
    coffeeLine: d.coffeeLine, leadToCoffeeId: plan.leadId!, leadLine: d.leadLine,
  });
  const after = (await currentRules(tx)).filter(x => x.id !== r.id);
  const othersUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!othersUnchanged) throw new Error('Not applied: another start rule changed in the same transaction.');
  return { plan, written: r.unchanged ? 0 : 1, newId: r.id, supersededId: r.supersededId, othersUnchanged };
}

/** Current first bags over current quiz results (all, and the rule's row). */
export async function startCounts(tx: Tx): Promise<Array<{ coffee_name: string | null; n: number }>> {
  return (await tx.query<{ coffee_name: string | null; n: number }>(
    `SELECT s.coffee_name, count(*)::int AS n FROM v_customer_quiz_current q JOIN v_dial_start s ON s.quiz_session_id = q.quiz_session_id
      GROUP BY 1 ORDER BY 2 DESC, 1`)).rows;
}

const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|');

export function formatPlan(plan: Plan, counts: Array<{ coffee_name: string | null; n: number }>): string {
  const c = plan.current;
  const out = [`Plan: ${plan.action}.`, ''];
  out.push('| field | now | next |', '|---|---|---|');
  out.push(`| rule | ${c ? `#${c.id} ${esc(c.family_code)} p${c.priority} ${esc(c.condition_code)}${c.also_condition_code ? ` + ${esc(c.also_condition_code)}` : ''}` : '(none)'} | same family, priority, condition |`);
  out.push(`| admin label | ${esc(c?.admin_label)} | (kept) |`);
  out.push(`| coffee | ${esc(c?.coffee_name)} | ${esc(plan.next.coffee)} |`);
  out.push(`| customer reason | ${esc(c?.customer_reason)} | ${esc(plan.next.customer_reason)} |`);
  out.push(`| coffee line | ${esc(c?.coffee_line)} | ${esc(plan.next.coffee_line)} |`);
  out.push(`| lead | ${esc(c?.lead_to_coffee_name)} | ${esc(plan.next.lead)} |`);
  out.push(`| lead line | ${esc(c?.lead_line)} | ${esc(plan.next.lead_line)} |`);
  out.push(`| lead quote family | ${esc(c?.lead_quote_family_code)} | (kept) |`);
  out.push(`| notes | ${esc(c?.notes)} | (kept) |`);
  out.push('', `Current quiz results starting on this row today: ${plan.startsOnRule}. Recorded match decisions picking ${RULE.fromCoffee}: ${plan.fabricatorDecisions.length ? plan.fabricatorDecisions.map(x => `${x.move_code} ${x.n}`).join(', ') : 'none'} (read only, never rewritten).`);
  if (plan.problems.length) out.push('', 'Problems:', ...plan.problems.map(p => `- ${p}`));
  out.push('', '| first bag (v_dial_start, current quiz results) | sessions |', '|---|---|');
  for (const r of counts) out.push(`| ${esc(r.coffee_name ?? '(no rule)')} | ${r.n} |`);
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
        const tx = client as unknown as Tx;
        console.log(`# Ella map 11 Tiger Stripe start, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planTigerStart(tx), await startCounts(tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const { result, counts } = await withTransaction(async tx => ({ result: await applyTigerStart(tx), counts: await startCounts(tx) }));
    console.log(`# Ella map 11 Tiger Stripe start, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} row(s) written`
      + (result.written ? `; new rule #${result.newId}, superseded #${result.supersededId}; other current rules unchanged: ${result.othersUnchanged}` : '') + '\n');
    console.log(formatPlan(result.plan, counts));
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
