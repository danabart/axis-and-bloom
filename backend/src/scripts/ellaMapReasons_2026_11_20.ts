// Ella's Bloom Map 9 (2026-11-20), Part E: enters what the map says back
// (Data 1, with the kitchen brands of C5), the start rules' personal lines and
// leads (Data 2) and every shown step's move and opening clause (Data 3 plus
// the 14 Dana approved at the Task 0 STOP), through the writers only:
// dialPlacementService.setSaidBackInTx, setStartRuleInTx, setStepInTx.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapReasons_2026_11_20.ts [--dry-run | --apply] [--publish "<label>"] [--expect-db <name>]
//
// --dry-run is the default and writes nothing (one READ ONLY transaction). It
// reads the base tables, so it also runs on a database that does not have the
// Ella map 9 schema yet: what is missing reads as empty.
// --apply writes in one transaction. A step's move and when_line travel with
// the step row (as its customer_line does), so they reach the customer page
// through Publish: --publish "<label>" publishes in the same transaction
// (dialPlacementService.publishInTx) and refuses, rolling everything back, if
// the new version's placements differ from the active version's in any way.
// Idempotent: a second run writes nothing (and --publish is then skipped).
// Coffees are found by name (ids differ between databases). The start rules
// are found by (family, priority) and must still name the coffee Data 2 names.
// A start rule whose current row was written after this script last ran (by
// Ella map 11 or /admin/map) is skipped and kept (lastRunAt), as Ella map 10
// keeps a phrase changed since.
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked from DATABASE_URL before connecting
// and from current_database() after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';

export const ACTOR = 'script:ellaMapReasons_2026_11_20';

/**
 * Data 1: what we say back about a quiz answer or a feeling (Dana 2026-11-20;
 * v7_q5_b changed at the Task 0 STOP). quoted false: the phrase is kept but
 * never quoted, on purpose (v7_q1_b, Dana 2026-11-20/21).
 */
export const DATA_1: Array<{ source: 'quiz_answer' | 'coffee_feeling'; fact: string; says: string; quoted?: boolean }> = [
  { source: 'quiz_answer', fact: 'v7_q1_a', says: "coffee is a daily ritual and you're particular about it" },
  { source: 'quiz_answer', fact: 'v7_q1_b', says: 'coffee is a reliable habit for you', quoted: false },
  { source: 'quiz_answer', fact: 'v7_q1_c', says: "you're still discovering coffee" },
  { source: 'quiz_answer', fact: 'v7_q2_a', says: 'a good cup is strong and satisfying' },
  { source: 'quiz_answer', fact: 'v7_q2_b', says: 'a good cup is smooth and easy the whole way' },
  { source: 'quiz_answer', fact: 'v7_q2_c', says: 'a good cup feels alive and changes as you drink it' },
  { source: 'quiz_answer', fact: 'v7_q3_a', says: 'you taste a black coffee first, then make it richer' },
  { source: 'quiz_answer', fact: 'v7_q3_b', says: 'you smooth a black coffee before you try it' },
  { source: 'quiz_answer', fact: 'v7_q3_c', says: 'your first thought with a black coffee is what flavors are in it' },
  { source: 'quiz_answer', fact: 'v7_q4_a', says: 'a coffee with no bitterness would bother you' },
  { source: 'quiz_answer', fact: 'v7_q4_b', says: 'too bitter is what would bother you most' },
  { source: 'quiz_answer', fact: 'v7_q4_c', says: 'a cup where every sip tastes the same would bother you' },
  { source: 'quiz_answer', fact: 'v7_q5_a', says: 'a little bitterness tastes serious to you' },
  { source: 'quiz_answer', fact: 'v7_q5_b', says: "you'd rather have something gentler" },
  { source: 'quiz_answer', fact: 'v7_q5_c', says: 'bitter coffee tastes burnt to you' },
  { source: 'quiz_answer', fact: 'v7_branch_cn_stay', says: 'coffee should feel like a reward: warm, rich, comforting' },
  { source: 'quiz_answer', fact: 'v7_branch_cn_earthy', says: 'you want coffee with a kick: dark, strong, a bit smoky' },
  { source: 'quiz_answer', fact: 'v7_branch_fruity_stay', says: 'coffee is at its best bright and lively' },
  { source: 'quiz_answer', fact: 'v7_branch_fruity_floral', says: 'coffee is at its best light and delicate, and the smell matters most' },
  { source: 'quiz_answer', fact: 'v7_branch_bal_cozy', says: "you'd be sad to lose the cozy, dessert-like feeling" },
  { source: 'quiz_answer', fact: 'v7_branch_bal_fruit', says: "you'd be sad to lose that little sweetness that reminds you of fruit" },
  { source: 'quiz_answer', fact: 'v7_branch_bal_floral', says: "you'd be sad to lose the smell" },
  { source: 'coffee_feeling', fact: 'bolder', says: 'something bolder than what you drink now' },
  { source: 'coffee_feeling', fact: 'gentler', says: 'something gentler than what you drink now' },
  { source: 'coffee_feeling', fact: 'different', says: 'something different from what you drink now' },
];

/**
 * C5 (Dana 2026-11-20): one row per listed kitchen brand that is a real brand
 * and not a partner roaster, with the brand's label as it is (read from the
 * database at run time). Not listed, so never quoted: nothing, dont_know,
 * pods_unknown, other, store_brand, local_roaster, and the partner roasters
 * joe_bean, joe_coffee, utopian, temecula, path (every roaster we have a row for).
 */
export const KITCHEN_BRANDS: string[] = [
  'dunkin', 'starbucks', 'peets', 'mcdonalds', 'tim_hortons', 'caribou', 'wawa',
  'folgers', 'maxwell_house', 'bustelo', 'pilon', 'lavazza', 'illy', 'eight_oclock', 'chock_full', 'green_mountain',
  'donut_shop', 'seattles_best', 'gevalia', 'community', 'death_wish', 'black_rifle', 'kirkland', 'trader_joes', 'aldi',
  'counter_culture', 'intelligentsia', 'stumptown', 'blue_bottle', 'la_colombe', 'verve', 'onyx', 'equator', 'ritual',
  'devocion', 'partners', 'irving_farm', 'cafe_grumpy', 'brooklyn_roasting', 'birch', 'stone_street', 'orens',
  'porto_rico', 'variety', 'rook', 'small_world', 'modcup', 'hidden_grounds',
];

/** The brew field whose values each brew source quotes (also dial_said_back_source.brew_field_code). */
const SOURCE_FIELD = { coffee_feeling: 'coffee_feeling', cupboard_coffee: 'cupboard_coffee' } as const;

/** Data 2: per start rule (family, priority, and the coffee it must still name), the personal line and the lead. */
export const DATA_2: Array<{ family: string; priority: number; coffee: string; coffeeLine: string; lead: string; leadLine: string; quote: string | null }> = [
  { family: 'balanced_sweet', priority: 1, coffee: 'Colombia La Familia Guarnizo', coffeeLine: 'So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end.', lead: 'The Village', leadLine: 'A little further the same way: just as light, with more flower and citrus in it.', quote: null },
  { family: 'balanced_sweet', priority: 9, coffee: 'Benchmark', coffeeLine: 'This is the cup where nothing sticks out, and it works however you make it.', lead: 'Colombia La Familia Guarnizo', leadLine: 'The gentlest step from here: lighter in the cup, with caramel, honey and a little clementine.', quote: null },
  { family: 'chocolate_nutty', priority: 2, coffee: 'Tiger Stripe Espresso', coffeeLine: 'This one is chocolate first with a little lift, and it was built for espresso.', lead: 'The Waverly', leadLine: 'More of the lift: fig and orange over dark chocolate.', quote: null },
  { family: 'chocolate_nutty', priority: 3, coffee: 'Fabricator House Roast', coffeeLine: 'This is chocolate and nut first, with a little lift.', lead: 'Geometric Filter Coffee', leadLine: 'The same family with more fruit, and sweeter.', quote: null },
  { family: 'chocolate_nutty', priority: 9, coffee: 'The Daily', coffeeLine: 'This is chocolate with some strength: our everyday cup.', lead: 'Amsterdam', leadLine: 'The next size up in strength: darker and smoother.', quote: null },
  { family: 'earthy', priority: 9, coffee: 'Amsterdam', coffeeLine: 'This one is deep and smooth, with dark chocolate and walnut.', lead: 'Great Heights', leadLine: 'The same idea, roasted darker.', quote: null },
  { family: 'fruity', priority: 1, coffee: 'Geometric Filter Coffee', coffeeLine: 'So: bright fruit, with caramel under it to make it an everyday cup.', lead: 'Colombia La Familia Guarnizo', leadLine: 'Lighter and sweeter: caramel, honey, a little clementine.', quote: null },
  { family: 'fruity', priority: 9, coffee: 'Cafè Feminista: Montze Olvera', coffeeLine: 'This one is soft and tropical, with papaya and candied coconut.', lead: 'The Village', leadLine: 'More delicate: more floral, with grapefruit.', quote: null },
  { family: 'floral', priority: 9, coffee: 'The Village', coffeeLine: 'This one is floral, with apple blossom and grapefruit.', lead: 'Cafè Feminista: Montze Olvera', leadLine: 'Creamier and more tropical: papaya and candied coconut.', quote: null },
];

/** Data 3 and the 14 approved at the STOP: every shown step's move (null = none) and when_line. */
export const DATA_3: Array<{ from: string; to: string; move: 'bolder' | 'gentler' | 'different' | null; when: string }> = [
  { from: 'Benchmark', to: 'The Daily', move: 'bolder', when: 'If you want more bite.' },
  { from: 'Benchmark', to: 'Colombia La Familia Guarnizo', move: 'gentler', when: 'If you want it lighter.' },
  { from: 'Benchmark', to: 'Fabricator House Roast', move: 'different', when: "If you're curious." },
  { from: 'Colombia La Familia Guarnizo', to: 'The Village', move: 'gentler', when: 'If you want it more delicate.' },
  { from: 'Colombia La Familia Guarnizo', to: 'Geometric Filter Coffee', move: 'bolder', when: 'If you like the fruit and want more coffee under it.' },
  { from: 'Colombia La Familia Guarnizo', to: 'Benchmark', move: 'different', when: 'If the fruit turns out to be more than you wanted.' },
  { from: 'The Daily', to: 'Amsterdam', move: 'bolder', when: 'If you want it darker.' },
  { from: 'The Daily', to: 'Benchmark', move: 'gentler', when: 'If it has more bite than you wanted.' },
  { from: 'Fabricator House Roast', to: 'Geometric Filter Coffee', move: 'different', when: 'If you want more fruit.' },
  { from: 'Fabricator House Roast', to: 'Brazil', move: 'gentler', when: 'If you want it simpler.' },
  { from: 'Fabricator House Roast', to: 'Benchmark', move: 'gentler', when: 'If you want it rounder.' },
  { from: 'Tiger Stripe Espresso', to: 'Geometric Filter Coffee', move: 'different', when: 'If you want more fruit and less weight.' },
  { from: 'Tiger Stripe Espresso', to: 'The Waverly', move: 'different', when: 'If you want more fruit and keep the chocolate.' },
  { from: 'Tiger Stripe Espresso', to: 'Blossom Dark Roast', move: 'bolder', when: 'If you want a darker roast.' },
  { from: 'Amsterdam', to: 'Great Heights', move: 'bolder', when: 'If you want it darker still.' },
  { from: 'Amsterdam', to: 'The Daily', move: 'gentler', when: 'If you want it lighter and sweeter.' },
  { from: 'Geometric Filter Coffee', to: 'Colombia La Familia Guarnizo', move: 'gentler', when: 'If you want it lighter.' },
  { from: 'Geometric Filter Coffee', to: 'Tiger Stripe Espresso', move: 'bolder', when: 'If you want more weight.' },
  { from: 'Geometric Filter Coffee', to: 'Fabricator House Roast', move: 'different', when: 'If you want less fruit.' },
  { from: 'Cafè Feminista: Montze Olvera', to: 'The Village', move: 'gentler', when: 'If you want it more delicate.' },
  { from: 'The Village', to: 'Cafè Feminista: Montze Olvera', move: 'different', when: 'If you want it creamier.' },
  { from: 'The Village', to: 'Colombia La Familia Guarnizo', move: 'different', when: 'If you want it sweeter and softer.' },
  // the 14 proposed at the Task 0 STOP, approved 2026-11-20 with two changes
  // (D.R. Congo's roaster notes do not say "citrus": "If you want it softer."; Half Moon and Nightcap: no move)
  { from: 'Geometric Filter Coffee', to: 'D.R. Congo', move: 'gentler', when: 'If you want it softer.' },
  { from: 'Big City', to: 'Great Heights', move: 'gentler', when: 'If you want less smoke.' },
  { from: 'Great Heights', to: 'Big City', move: 'bolder', when: 'If you want it darker still.' },
  { from: 'Great Heights', to: 'Amsterdam', move: 'gentler', when: 'If you want it lighter.' },
  { from: 'Blossom Dark Roast', to: 'Tiger Stripe Espresso', move: 'gentler', when: 'If you want a lighter roast.' },
  { from: 'Blossom Dark Roast', to: 'Brazil', move: 'gentler', when: 'If you want it simpler.' },
  { from: 'Blossom Dark Roast', to: 'Indonesia', move: 'different', when: 'If you want it earthier.' },
  { from: 'Indonesia', to: 'Blossom Dark Roast', move: 'different', when: 'If you want it cleaner.' },
  { from: 'Brazil', to: 'Blossom Dark Roast', move: 'bolder', when: 'If you want a darker roast.' },
  { from: 'Brazil', to: 'Fabricator House Roast', move: 'different', when: 'If you want more going on.' },
  { from: 'D.R. Congo', to: 'Geometric Filter Coffee', move: 'bolder', when: 'If you want more weight.' },
  { from: 'The Waverly', to: 'Tiger Stripe Espresso', move: 'different', when: 'If you want less fruit.' },
  { from: 'Half Moon (Half Caff)', to: 'Nightcap Decaf', move: null, when: 'If you want no caffeine at all.' },
  { from: 'Nightcap Decaf', to: 'Half Moon (Half Caff)', move: null, when: 'If you want a little caffeine back.' },
];

export type Action = 'write' | 'same' | 'skip';
export interface PlanRow { section: 'said_back' | 'start_rule' | 'step'; subject: string; now: string; next: string; action: Action; why?: string }
export interface Plan { rows: PlanRow[]; schemaPresent: boolean }

const has = async (tx: Tx, rel: string) => (await tx.query<{ r: string | null }>(`SELECT to_regclass($1)::text AS r`, [rel])).rows[0].r !== null;
const hasCol = async (tx: Tx, table: string, col: string) =>
  (await tx.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, col])).rows.length > 0;
const show = (v: string | null | undefined) => (v === null || v === undefined ? '(none)' : `"${v}"`);
/** A said-back row as the plan compares it: the phrase, marked when it is never quoted. */
const phrase = (says: string, quoted: boolean) => (quoted ? says : `${says} [never quoted]`);

interface Facts { saidBack: Map<string, string>; facts: Map<string, string>; kitchenLabels: Map<string, string> }

// Ella map 10 (Task 0 item 4): every read goes through the table's view.
async function readFacts(tx: Tx): Promise<Facts> {
  const saidBack = new Map<string, string>();
  const r = await tx.query<{ source_code: string; fact_code: string; says_back: string; is_quoted: boolean }>(
    `SELECT source_code, fact_code, says_back, is_quoted FROM v_dial_said_back WHERE is_current`);
  for (const x of r.rows) saidBack.set(`${x.source_code}:${x.fact_code}`, phrase(x.says_back, x.is_quoted));
  // the facts the map could say back: the current answers of the active quizzes and the active brew values
  const facts = new Map<string, string>();
  const kitchenLabels = new Map<string, string>();
  const f = await tx.query<{ source_code: string; fact_code: string; fact_label: string }>(
    `SELECT source_code, fact_code, fact_label FROM v_dial_said_back_fact`);
  for (const x of f.rows) {
    facts.set(`${x.source_code}:${x.fact_code}`, x.fact_label);
    if (x.source_code === SOURCE_FIELD.cupboard_coffee) kitchenLabels.set(x.fact_code, x.fact_label);
  }
  return { saidBack, facts, kitchenLabels };
}

/** Every said-back row this script writes: Data 1 plus one per kitchen brand, its phrase the brand's label. */
async function wantedSaidBack(tx: Tx, f: Facts): Promise<Array<{ source: string; fact: string; says: string; quoted?: boolean }>> {
  return [
    ...DATA_1,
    ...KITCHEN_BRANDS.map(code => ({ source: 'cupboard_coffee' as const, fact: code, says: f.kitchenLabels.get(code) ?? '' })),
  ];
}


async function coffeeIdByName(tx: Tx): Promise<Map<string, number>> {
  const r = await tx.query<{ id: number; name: string }>(`SELECT c.id, c.name FROM v_coffee c WHERE c.is_active`);
  const m = new Map<string, number>();
  const dup = new Set<string>();
  for (const x of r.rows) { if (m.has(x.name)) dup.add(x.name); m.set(x.name, x.id); }
  for (const d of dup) m.delete(d); // an ambiguous name resolves to nothing (the plan skips it)
  return m;
}

/**
 * When this script last ran on this database: the latest row it wrote itself
 * (decided_by = ACTOR) in any of the three tables it writes, current or
 * superseded. Null when it has never run here (the first run writes as
 * planned).
 */
export async function lastRunAt(tx: Tx): Promise<Date | null> {
  const r = await tx.query<{ t: Date | null }>(
    `SELECT max(t) AS t FROM (
       SELECT max(created_at) AS t FROM v_dial_said_back WHERE decided_by = $1
       UNION ALL SELECT max(created_at) FROM v_dial_step WHERE decided_by = $1
       UNION ALL SELECT max(created_at) FROM v_dial_start_rule WHERE decided_by = $1) x`, [ACTOR]);
  return r.rows[0].t ? new Date(r.rows[0].t) : null;
}

/** Read-only: what --apply would write, row by row. */
export async function planReasons(tx: Tx): Promise<Plan> {
  const schema = await has(tx, 'dial_said_back') && await hasCol(tx, 'dial_step', 'when_line') && await hasCol(tx, 'dial_start_rule', 'coffee_line');
  if (!schema) throw new Error('the Ella map 9 schema is not on this database yet; deploy first');
  const f = await readFacts(tx);
  const ids = await coffeeIdByName(tx);
  const nameOf = new Map([...ids].map(([n, id]) => [id, n]));
  const rows: PlanRow[] = [];

  for (const d of await wantedSaidBack(tx, f)) {
    const subject = `${d.source} ${d.fact}`;
    const now = f.saidBack.get(`${d.source}:${d.fact}`) ?? null;
    if (!f.facts.has(`${d.source}:${d.fact}`) || !d.says) { rows.push({ section: 'said_back', subject, now: show(now), next: show(d.says), action: 'skip', why: 'no current fact with this code' }); continue; }
    const next = phrase(d.says, d.quoted ?? true);
    // Ella map 10: Data 1's phrases were rewritten by ellaMapReasonsRev2_2026_11_23; a phrase changed since is never written back
    if (d.source !== 'cupboard_coffee' && now !== null && now !== next) {
      rows.push({ section: 'said_back', subject, now: show(now), next: show(next), action: 'skip', why: 'changed since (Rev 2 seed or /admin/map); kept' });
      continue;
    }
    rows.push({ section: 'said_back', subject, now: show(now), next: show(next), action: now === next ? 'same' : 'write' });
  }

  const rules = (await tx.query<Record<string, unknown>>(
    `SELECT r.family_code AS family, r.priority, r.coffee_name, r.coffee_line, r.lead_to_coffee_id, r.lead_line, r.lead_quote_family_code AS lead_quote,
            r.created_at, r.decided_by
       FROM v_dial_start_rule r WHERE r.is_current`)).rows;
  const lastRun = await lastRunAt(tx);
  for (const d of DATA_2) {
    const subject = `${d.family} #${d.priority} (${d.coffee})`;
    const next = `${show(d.coffeeLine)} / lead ${d.lead}: ${show(d.leadLine)} / quote ${d.quote ?? '(none)'}`;
    const r = rules.find(x => x.family === d.family && Number(x.priority) === d.priority);
    if (!r) { rows.push({ section: 'start_rule', subject, now: '(no current rule)', next, action: 'skip', why: 'no current rule at this family and priority' }); continue; }
    // Ella map 11 follow-up: a rule written after this script last ran (Ella map 11, /admin/map) is never written back
    if (lastRun && r.decided_by !== ACTOR && new Date(r.created_at as string).getTime() > lastRun.getTime()) {
      rows.push({ section: 'start_rule', subject, now: `names ${String(r.coffee_name)}, written ${new Date(r.created_at as string).toISOString()} by ${String(r.decided_by ?? '(unknown)')}`, next, action: 'skip',
        why: `written since this script last ran (${lastRun.toISOString()}); kept` });
      continue;
    }
    if (r.coffee_name !== d.coffee) { rows.push({ section: 'start_rule', subject, now: `names ${String(r.coffee_name)}`, next, action: 'skip', why: 'the rule names another coffee now' }); continue; }
    const leadId = ids.get(d.lead);
    const now = schema
      ? `${show(r.coffee_line as string | null)} / lead ${r.lead_to_coffee_id ? nameOf.get(Number(r.lead_to_coffee_id)) ?? r.lead_to_coffee_id : '(none)'}: ${show(r.lead_line as string | null)} / quote ${(r.lead_quote as string | null) ?? '(none)'}`
      : '(no columns yet)';
    const same = schema && r.coffee_line === d.coffeeLine && Number(r.lead_to_coffee_id) === leadId && r.lead_line === d.leadLine && (r.lead_quote ?? null) === d.quote;
    rows.push({ section: 'start_rule', subject, now, next, action: same ? 'same' : 'write' });
  }

  const steps = (await tx.query<Record<string, unknown>>(
    `SELECT s.from_coffee_name AS from_name, s.to_coffee_name AS to_name, s.move_code, s.when_line
       FROM v_dial_step s WHERE s.is_current AND s.is_shown`)).rows;
  for (const d of DATA_3) {
    const subject = `${d.from} -> ${d.to}`;
    const next = `${d.move ?? '(no move)'} / ${show(d.when)}`;
    const s = steps.find(x => x.from_name === d.from && x.to_name === d.to);
    if (!s) { rows.push({ section: 'step', subject, now: '(no current shown step)', next, action: 'skip', why: 'no current shown step between these coffees' }); continue; }
    const now = schema ? `${(s.move_code as string | null) ?? '(no move)'} / ${show(s.when_line as string | null)}` : '(no columns yet)';
    const same = schema && (s.move_code ?? null) === d.move && s.when_line === d.when;
    rows.push({ section: 'step', subject, now, next, action: same ? 'same' : 'write' });
  }
  for (const s of steps) {
    if (!DATA_3.some(d => d.from === s.from_name && d.to === s.to_name)) {
      rows.push({ section: 'step', subject: `${String(s.from_name)} -> ${String(s.to_name)}`, now: '', next: '(no data)', action: 'skip', why: 'a shown step this script carries nothing for' });
    }
  }
  return { rows, schemaPresent: schema };
}

export interface ApplyResult { plan: Plan; written: number; published: { versionId: number; label: string; placements: number } | null }

/** --apply inside the caller's transaction: exactly the plan's write rows, through the writers; then the optional publish. */
export async function applyReasons(tx: Tx, opts: { publishLabel?: string | null } = {}): Promise<ApplyResult> {
  const { setSaidBackInTx, setStartRuleInTx, setStepInTx, publishInTx } = await import('../services/dialPlacementService.js');
  const plan = await planReasons(tx);
  if (!plan.schemaPresent) throw new Error('the Ella map 9 schema is not on this database yet; deploy first');
  const f = await readFacts(tx);
  const ids = await coffeeIdByName(tx);
  const isWrite = (section: PlanRow['section'], subject: string) => plan.rows.some(r => r.section === section && r.subject === subject && r.action === 'write');
  let written = 0;
  let stepsWritten = 0;

  for (const d of await wantedSaidBack(tx, f)) {
    if (!isWrite('said_back', `${d.source} ${d.fact}`)) continue;
    const r = await setSaidBackInTx(tx, { sourceCode: d.source, factCode: d.fact, saysBack: d.says, isQuoted: d.quoted ?? true, adminUid: ACTOR });
    if (!r.unchanged) written++;
  }
  for (const d of DATA_2) {
    if (!isWrite('start_rule', `${d.family} #${d.priority} (${d.coffee})`)) continue;
    const r = (await tx.query<{ condition_code: string; also_condition_code: string | null; coffee_id: number; admin_label: string; customer_reason: string; notes: string | null }>(
      `SELECT condition_code, also_condition_code, coffee_id, admin_label, customer_reason, notes FROM v_dial_start_rule
        WHERE is_current AND family_code = $1 AND priority = $2`, [d.family, d.priority])).rows[0];
    const res = await setStartRuleInTx(tx, {
      familyCode: d.family, priority: d.priority, conditionCode: r.condition_code, alsoConditionCode: r.also_condition_code,
      coffeeId: r.coffee_id, adminLabel: r.admin_label, customerReason: r.customer_reason, notes: r.notes, adminUid: ACTOR,
      coffeeLine: d.coffeeLine, leadToCoffeeId: ids.get(d.lead) ?? null, leadLine: d.leadLine, leadQuoteFamilyCode: d.quote,
    });
    if (!res.unchanged) written++;
  }
  for (const d of DATA_3) {
    if (!isWrite('step', `${d.from} -> ${d.to}`)) continue;
    const s = (await tx.query<{ from_coffee_id: number; to_coffee_id: number; button_word: string; customer_line: string | null; basis_code: string; is_shown: boolean }>(
      `SELECT from_coffee_id, to_coffee_id, button_word, customer_line, basis_code, is_shown FROM v_dial_step
        WHERE is_current AND from_coffee_id = $1 AND to_coffee_id = $2`, [ids.get(d.from), ids.get(d.to)])).rows[0];
    const res = await setStepInTx(tx, {
      fromCoffeeId: s.from_coffee_id, toCoffeeId: s.to_coffee_id, buttonWord: s.button_word, customerLine: s.customer_line,
      basisCode: s.basis_code, isShown: s.is_shown, adminUid: ACTOR, moveCode: d.move, whenLine: d.when,
    });
    if (!res.unchanged) { written++; stepsWritten++; }
  }

  let published: ApplyResult['published'] = null;
  if (opts.publishLabel && stepsWritten > 0) {
    const shape = `SELECT coffee_id, archetype_code::text, ring, lane_code, size FROM v_dial_placement ORDER BY coffee_id`;
    const before = JSON.stringify((await tx.query(shape)).rows);
    const p = await publishInTx(tx, { label: opts.publishLabel, reason: 'Ella map 9: each step carries its move and when_line (no change to the map shape)', adminUid: ACTOR });
    const after = JSON.stringify((await tx.query(shape)).rows);
    if (before !== after) throw new Error('REFUSING to publish: the new version would change the placements; nothing was written');
    published = { versionId: p.versionId, label: p.label, placements: p.placements };
  }
  return { plan, written, published };
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  const count = (a: Action) => plan.rows.filter(r => r.action === a).length;
  out.push(`Plan: ${count('write')} write, ${count('same')} unchanged, ${count('skip')} skipped.${plan.schemaPresent ? '' : ' (The Ella map 9 schema is not on this database yet: every "now" reads as empty.)'}`);
  for (const s of ['said_back', 'start_rule', 'step'] as const) {
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
  return { apply, expectDb: at('--expect-db') ?? 'axisandbloom_test', publishLabel: at('--publish') ?? null };
}

async function main() {
  const { apply, expectDb, publishLabel } = parseArgs(process.argv.slice(2));
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
        console.log(`# Ella map 9 reasons, DRY RUN on ${cur} (${new Date().toISOString()})\n`);
        console.log(formatPlan(await planReasons(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const result = await withTransaction(tx => applyReasons(tx, { publishLabel }));
    console.log(`# Ella map 9 reasons, APPLIED on ${cur} (${new Date().toISOString()}): ${result.written} row(s) written`);
    console.log(result.published ? `Published: ${result.published.label} (version ${result.published.versionId}, ${result.published.placements} placements)\n` : 'Published: nothing\n');
    console.log(formatPlan(result.plan));
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
