// Ella's Bloom Map 10 (2026-11-24), Part D: the reasons on /map, Rev 2.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_10_REASONS_REV2.md
// Every card is one sentence about the customer and one about the coffee;
// how a card is chosen is data (dial_reason_choice). Test DB only, every test
// inside a rolled-back transaction; marked 'Zzz Map10' fixtures. The approved
// words (Data 1 and Data 2 of the design) are written by the Rev 2 seed,
// ensured here; the five worked pages are pinned word for word.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import * as reads from './customerReads.js';
import { setSaidBackInTx, setReasonChoiceInTx, DialMapError } from './dialPlacementService.js';
import { updateCoffeeInTx, CatalogError } from './catalogService.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyRev2 } from '../scripts/ellaMapReasonsRev2_2026_11_23.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';
import { applyComparisons } from '../scripts/ellaMapStepComparisons_2026_11_25.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

async function ensureRev2(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map10 test ${randomUUID()}` });
  await applyRev2(tx(c));
  // Ella map 12 (2026-11-26): the step lines compare to the position coffee and the treat row is on (published in the rollback)
  await applyComparisons(tx(c));
}

interface Fixture {
  primary: string; scores: Record<string, number>; answers: string[];
  branch?: string | null; branchedFrom?: string | null; proxy?: boolean; kitchen?: string | null; feeling?: string | null;
}
async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map10') RETURNING id`, [`zzz-map10-${randomUUID()}`])).rows[0].id;
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;
async function person(c: pg.PoolClient, f: Fixture): Promise<{ userId: string; sessionId: string }> {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = $1`, [f.primary])).rows[0].id;
  const ids = [] as string[];
  for (const a of f.answers) ids.push(await answerId(c, a));
  const branch = f.branch ? await answerId(c, f.branch) : null;
  const takenBy = f.proxy ? await newProfile(c) : null;
  const context: Record<string, unknown> = { archetype: f.primary, scores: f.scores, branchedFrom: f.branchedFrom ?? null, answerIds: ids };
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id, taken_by_user_id)
     VALUES ($1, $2, $3, timezone('utc', now()), $4, $5) RETURNING id`,
    [userId, arch, JSON.stringify(context), branch, takenBy])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', $2)`, [sessionId, f.primary]);
  for (const [field, value] of [['cupboard_coffee', f.kitchen], ['coffee_feeling', f.feeling]] as const) {
    if (!value) continue;
    await c.query(
      `INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, $3, $4, 'set')`,
      [userId, `zzz-map10-${randomUUID()}`, field, JSON.stringify(value)]);
  }
  return { userId, sessionId };
}
const quizDecide = (c: pg.PoolClient, p: { userId: string; sessionId: string }) => match.decide({
  userId: p.userId, trigger: 'quiz_result', move: 'quiz_result', source: 'quiz', sourceId: p.sessionId, quizSessionId: p.sessionId,
}, c);
const page = (c: pg.PoolClient, userId: string, opts: match.StepsOptions = { withBasis: true }) => match.steps(userId, c, opts);
const copyOf = async (c: pg.PoolClient) => Object.fromEntries((await c.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(r => [r.code, r.text]));
const said = async (c: pg.PoolClient, source: string, fact: string) =>
  (await c.query<{ says_back: string }>(`SELECT says_back FROM v_dial_said_back WHERE is_current AND source_code = $1 AND fact_code = $2`, [source, fact])).rows[0]?.says_back;
const placedId = async (c: pg.PoolClient, mapName: string) =>
  (await c.query<{ coffee_id: number }>(`SELECT p.coffee_id FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id WHERE a.map_name = $1`, [mapName])).rows[0].coffee_id;
const cards = (r: match.MapStepsResult) => r.steps.map(s => [s.name, s.isLead, s.text]);
const choice = (c: pg.PoolClient, kindCode: string, code: string, patch: { sortOrder?: number; isActive?: boolean }) =>
  setReasonChoiceInTx(tx(c), { kindCode, code, ...patch, adminUid: 'zzz-map10' });

/**
 * Dana's account on production (Task 0 item 2): a quiz_result on Tiger Stripe
 * recorded under L0, before the start rules (no rule_id), then "Same again";
 * all Chocolate & Nutty answers, the setup feeling "different". Ella map 12
 * (Dana 2026-11-26): her pinned page carries her answer since 2026-11-25,
 * "happy"; the lead-source tests keep "different", a feeling with a direction.
 */
async function danaLike(c: pg.PoolClient, feeling = 'different') {
  const p = await person(c, { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 9 }, branch: 'v7_branch_cn_stay',
    answers: ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_c'], feeling });
  const tiger = await placedId(c, 'Tiger Stripe');
  const version = (await c.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0].id;
  const move = async (code: string) => (await c.query<{ id: number }>(`SELECT id FROM dial_move WHERE code = $1`, [code])).rows[0].id;
  // a fixture of an old decision, written as L0 wrote it (inputs without rule_id); test DB only, rolled back
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, picked_coffee_id, source, source_id, inputs)
     VALUES ($1, timezone('utc', now()) - interval '2 hours', $2, $3, $4, 'quiz', $5, $6)`,
    [p.userId, version, await move('quiz_result'), tiger, p.sessionId, JSON.stringify({ rule: 'derived', quiz: { session_id: p.sessionId } })]);
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, from_coffee_id, picked_coffee_id, source, source_id, inputs)
     VALUES ($1, timezone('utc', now()) - interval '1 hour', $2, $3, $4, $4, 'map', $5, '{}')`,
    [p.userId, version, await move('stay'), tiger, `zzz-map10-${randomUUID()}`]);
  return p;
}
const P85: Fixture = { primary: 'Balanced', scores: { 'Balanced & Sweet': 8, Fruity: 1 }, answers: ['v7_q1_c', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'] };
const P33: Fixture = { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 5, 'Balanced & Sweet': 3, Fruity: 1 }, answers: ['v7_q1_b', 'v7_q2_b', 'v7_q3_c', 'v7_q4_a', 'v7_q5_a', 'v7_q6_b'] };
const P23: Fixture = { primary: 'Fruity', scores: { Fruity: 8, 'Chocolate & Nutty': 1 }, answers: ['v7_q1_a', 'v7_q2_c', 'v7_q3_c', 'v7_q4_c', 'v7_q5_c', 'v7_q6_b'] };
const P81: Fixture = { primary: 'Balanced', scores: { 'Balanced & Sweet': 4, 'Chocolate & Nutty': 3, Fruity: 2 },
  answers: ['v7_q1_b', 'v7_q2_c', 'v7_q3_b', 'v7_q4_b', 'v7_q5_a', 'v7_q6_a'], kitchen: 'counter_culture', feeling: 'gentler' };

describe('the worked pages, word for word (design Rev 2; Dana 2026-11-24 on the setup tie)', () => {
  it("Dana's account: Founder's pick on a first match no rule explains; Blossom leads by the strongest quiz support (feeling happy, Ella map 12)", async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const p = await danaLike(c, 'happy');
      const r = await page(c, p.userId);
      expect(r.position!.name).toBe('Tiger Stripe');
      // Ella map 14: hasBag is an attributed real order; her "same again" row is a decision, not a bag
      expect(r.position!.hasBag).toBe(false);
      expect(r.firstBag!.labelCode).toBe('founder_pick');
      expect(r.firstBag!.text).toBe('Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso.');
      expect(cards(r)).toEqual([
        // Ella map 12: "happy" says nothing back and argues for no step, so the strongest support leads
        ['Blossom', true, 'For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body.'],
        // nothing else supports Geometric, used or not: the treat answer, whose family is Geometric's
        ['Geometric', false, "Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it."],
        ['The Waverly', false, "Coffee is a daily ritual for you, and you're particular about it. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange."],
      ]);
    });
  });

  it('person 85, 33 and 23 (no decision; read as the start rule) and 81 (decided)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const read = async (f: Fixture, decide = false) => {
        const p = await person(c, f);
        if (decide) await quizDecide(c, p);
        return page(c, p.userId, { withBasis: true, readAsRule: true });
      };
      const r85 = await read(P85);
      expect([r85.position!.name, r85.firstBag!.labelCode, r85.firstBag!.text]).toEqual(['La Familia', 'founder_pick',
        "You'd rather have something gentler. For you, a good cup is smooth and easy the whole way. You're still discovering coffee. So we started you gentle, with one small new thing: caramel and honey, and a little clementine at the end."]);
      expect(cards(r85)).toEqual([
        ['The Village', true, 'A little further the same way: just as light, with more flower and citrus in it.'],
        ['Benchmark', false, 'Too bitter is what would bother you most. Rounder than La Familia: pure chocolate, less fruit.'],
        ['Geometric', false, "You're still discovering coffee. Keeps the fruit of La Familia and adds weight: bright fruit over caramel."], // reuses a top-card answer
      ]);
      const r33 = await read(P33);
      expect(r33.firstBag!.text).toBe('A little bitterness tastes serious to you. A coffee with no bitterness would bother you. This is chocolate with some strength: our everyday cup.');
      expect(cards(r33)).toEqual([
        ['Amsterdam', true, 'The next size up in strength: darker and smoother.'],
        ['Benchmark', false, 'For you, a good cup is smooth and easy the whole way. The same chocolate as The Daily, rounder and softer.'],
      ]);
      const r23 = await read(P23);
      expect(r23.firstBag!.text).toBe("Bitter coffee tastes burnt to you. For you, a good cup feels alive and changes as you drink it. Coffee is a daily ritual for you, and you're particular about it. So: bright fruit, with caramel under it to make it an everyday cup.");
      expect(cards(r23)).toEqual([
        ['La Familia', true, 'Lighter and sweeter: caramel, honey, a little clementine.'],
        ['Fabricator', false, 'A cup where every sip tastes the same would bother you. Made from the same coffees as Geometric, with less fruit: drier and nuttier.'],
        ['Tiger Stripe', false, "Coffee is a daily ritual for you, and you're particular about it. More chocolate and body than Geometric, with the fruit behind."], // reuses a top-card answer
        ['D.R. Congo', false, 'With a black coffee, your first thought is what flavors are in it. Lighter than Geometric: clementine and nectarine over caramel and light chocolate.'],
      ]);
      const r81 = await read(P81, true);
      expect(r81.readAs).toBeUndefined();
      expect(r81.firstBag!.text).toBe('You have Counter Culture Coffee in your kitchen. Too bitter is what would bother you most. You smooth a black coffee before you try it. This is the cup where nothing sticks out, and it works however you make it.');
      expect(cards(r81)).toEqual([
        ['La Familia', true, "You'd like something gentler than what you drink now. Lighter in the cup than Benchmark: caramel and honey, with a little clementine."],
        ['The Daily', false, 'A little bitterness tastes serious to you. The same chocolate as Benchmark, livelier, with a bit more bite.'],
        ['Fabricator', false, 'For you, a good cup feels alive and changes as you drink it. More going on than Benchmark: hazelnut, a little citrus, a dry finish.'],
      ]);
      // no brief 9 frame and no when_line in any composed text; an answer is used once per page
      const whenLines = (await c.query<{ when_line: string }>(`SELECT DISTINCT when_line FROM v_dial_step WHERE when_line IS NOT NULL`)).rows.map(x => x.when_line);
      for (const r of [r85, r33, r23, r81]) {
        const texts = [r.firstBag!.text, ...r.steps.map(s => s.text)];
        for (const t of texts) {
          for (const frame of ['You told us', 'You also said', 'You asked for', 'If you want', 'This moves away', 'This goes the other way']) expect(t).not.toContain(frame);
          for (const w of whenLines) expect(t).not.toContain(w);
        }
        // dial_step_reuse_answer on (the seed): the top card and the lead use each answer once;
        // an answer repeats only on a step card that found no unused one
        const firstUse = [...r.firstBag!.basis!.factCodes, ...r.steps.filter(s => s.isLead).flatMap(s => s.basis!.factCodes)];
        expect(new Set(firstUse).size).toBe(firstUse.length);
      }
      // with the parameter off, each answer is used once per page and the reusing cards read no_support
      await setParameterInTx(tx(c), { key: 'dial_step_reuse_answer', value: 0, adminId: 'zzz-map10' });
      const copy = await copyOf(c);
      for (const r of [await read(P85), await read(P23)]) {
        const facts = [...r.firstBag!.basis!.factCodes, ...r.steps.flatMap(s => s.basis!.factCodes)];
        expect(new Set(facts).size).toBe(facts.length);
      }
      expect(cards(await read(P85)).find(x => x[0] === 'Geometric')![2]).toBe(`${copy.no_support} Keeps the fruit of La Familia and adds weight: bright fruit over caramel.`);
      expect(cards(await read(P23)).find(x => x[0] === 'Tiger Stripe')![2]).toBe(`${copy.no_support} More chocolate and body than Geometric, with the fruit behind.`);
    });
  });
});

describe('the top card in each state (B2)', () => {
  it("first match by the rule; \"Same again\" keeps Founder's pick; after a step, You are here; no quiz, none", async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const p = await person(c, P81);
      await quizDecide(c, p);
      const first = await page(c, p.userId);
      expect(first.firstBag!.labelCode).toBe('founder_pick');
      expect(first.position!.hasBag).toBe(false);
      // Same again (as the L0 workbench recorded it): the coffee does not change, still a first match
      const v = (await c.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0].id;
      await c.query(`INSERT INTO customer_match_decision (user_id, version_id, move_id, from_coffee_id, picked_coffee_id, source, source_id)
                     SELECT $1, $2, m.id, $3, $3, 'map', $4 FROM dial_move m WHERE m.code = 'stay'`, [p.userId, v, first.position!.coffeeId, `zzz-map10-${randomUUID()}`]);
      const same = await page(c, p.userId);
      expect(same.firstBag!.labelCode).toBe('founder_pick');
      expect(same.firstBag!.text).toBe(first.firstBag!.text);
      // Ella map 14: a step decision no longer moves the spot; a reorder does. Then here_title ("Your spot"),
      // answers for this coffee's families, then its map_line. Two real orders of the coffee, in two orders.
      const step = first.steps.find(s => !s.isLead)!;
      await match.decide({ userId: p.userId, trigger: 'hop', move: 'step', pickedCoffeeId: step.coffeeId, source: 'map', sourceId: randomUUID() }, c);
      expect((await page(c, p.userId)).firstBag!.labelCode).toBe('founder_pick');
      const sku = (await c.query<{ id: string }>(`SELECT id FROM coffee_sku WHERE coffee_id = $1 ORDER BY is_active DESC, id LIMIT 1`, [step.coffeeId])).rows[0].id;
      for (const secs of [1, 2]) {
        const o = (await c.query<{ id: string }>(
          `INSERT INTO "order" (user_id, total_amount_paid, paid_at, created_at, stripe_mode) VALUES ($1, 29, clock_timestamp() + make_interval(secs => $2), clock_timestamp() + make_interval(secs => $2), 'live') RETURNING id`,
          [p.userId, secs])).rows[0].id;
        await c.query(`INSERT INTO order_line_item (order_id, blend_id, quantity, intended_for_user_id) VALUES ($1, $2, 1, $3)`, [o, sku, p.userId]);
        await c.query(`INSERT INTO order_event (order_id, event_kind, payment_status, source) VALUES ($1, 'paid', 'paid', 'webhook')`, [o]);
      }
      const after = await page(c, p.userId);
      expect(after.position!.coffeeId).toBe(step.coffeeId);
      expect(after.firstBag!.labelCode).toBe('here_title');
      const mapLine = (await c.query<{ map_line: string }>(`SELECT map_line FROM v_dial_coffee_availability WHERE coffee_id = $1`, [step.coffeeId])).rows[0].map_line;
      expect(after.firstBag!.text.endsWith(mapLine)).toBe(true);
      expect(after.firstBag!.basis!.ruleId).toBeNull();
      // no quiz: the session moves to another profile inside the rollback
      await c.query(`UPDATE quiz_session SET user_id = $2 WHERE id = $1`, [p.sessionId, await newProfile(c)]);
      expect((await page(c, p.userId)).firstBag).toBeNull();
    });
  });

  it("no usable answer and a rule that names the coffee: the rule's customer_reason; a proxy quiz and a never-quoted row are not used", async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const proxy = await person(c, { ...P85, proxy: true });
      await quizDecide(c, proxy);
      const r = await page(c, proxy.userId);
      expect(r.firstBag!.labelCode).toBe('founder_pick');
      expect(r.firstBag!.text).toBe(r.firstBag!.reason);
      expect([...r.firstBag!.basis!.factCodes, ...r.steps.flatMap(s => s.basis!.factCodes)].filter(f => f.startsWith('v7_'))).toEqual([]);
      // v7_q1_b is never quoted (is_quoted false): 33's page never carries it
      const p = await person(c, P33);
      const r33 = await page(c, p.userId, { withBasis: true, readAsRule: true });
      expect([...r33.firstBag!.basis!.factCodes, ...r33.steps.flatMap(s => s.basis!.factCodes)]).not.toContain('v7_q1_b');
    });
  });
});

describe('how a card is chosen is data (dial_reason_choice)', () => {
  it('a support kind switched off is skipped; reordering changes the pick; all off gives no_support', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const copy = await copyOf(c);
      const p = await danaLike(c);
      const blossom = async () => (await page(c, p.userId)).steps.find(s => s.name === 'Blossom')!;
      expect((await blossom()).basis!.choice).toBe('family_and_direction');
      await choice(c, 'step_support', 'family_and_direction', { isActive: false });
      const b2 = await blossom();
      expect(b2.basis!.choice).toBe('family');
      expect(b2.text.startsWith((await said(c, 'quiz_answer', 'v7_q1_a'))!)).toBe(true); // the family answer with no direction first
      await choice(c, 'step_support', 'family_and_direction', { isActive: true });
      await choice(c, 'step_support', 'family', { sortOrder: 0 });
      expect((await blossom()).basis!.choice).toBe('family');
      // Ella map 12: treat too, or a step of the treat's family would carry it
      for (const code of ['family_and_direction', 'family', 'direction', 'treat']) await choice(c, 'step_support', code, { isActive: false });
      const r = await page(c, p.userId);
      for (const s of r.steps.filter(x => !x.isLead)) expect(s.text.startsWith(copy.no_support)).toBe(true);
    });
  });

  it('the lead sources in order: setup answer, start rule, strongest support; each switched off; all off, no lead', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const dana = await danaLike(c);
      expect((await page(c, dana.userId)).steps[0].basis!.choice).toBe('setup_answer');
      await choice(c, 'lead_source', 'setup_answer', { isActive: false });
      // no rule names Tiger Stripe for her: strongest support leads (Blossom, family and direction), as the design first drew it
      const r = await page(c, dana.userId);
      expect(cards(r)[0]).toEqual(['Blossom', true, 'For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body.']);
      expect(r.steps[0].basis!.choice).toBe('strongest_support');
      // the feeling, no longer used by the lead, supports a step in its direction like any answer
      expect(r.steps.find(s => s.name === 'Geometric')!.text).toBe("You'd like a change from what you drink now. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it.");
      // 85: the start rule's lead; switched off, strongest support
      const p85 = await person(c, P85);
      await quizDecide(c, p85);
      expect((await page(c, p85.userId)).steps[0].basis!.choice).toBe('start_rule');
      await choice(c, 'lead_source', 'start_rule', { isActive: false });
      expect((await page(c, p85.userId)).steps[0].basis!.choice).toBe('strongest_support');
      await choice(c, 'lead_source', 'strongest_support', { isActive: false });
      expect((await page(c, p85.userId)).steps.some(s => s.isLead)).toBe(false);
    });
  });

  it('an unknown choice code is skipped at read and reported by check 15', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const p = await danaLike(c);
      const before = cards(await page(c, p.userId));
      await setReasonChoiceInTx(tx(c), { kindCode: 'step_support', code: 'zzz_unknown', label: 'Zzz', sortOrder: 0, adminUid: 'zzz-map10' });
      expect(cards(await page(c, p.userId))).toEqual(before);
      const c15 = (await dialMapChecks(c)).find(k => k.id === 15)!;
      expect(c15.pass).toBe(false);
      expect(c15.details).toContain('step_support zzz_unknown');
    });
  });
});

describe('the writers and the folded lookups (B1, B3)', () => {
  it('setReasonChoiceInTx supersedes and inserts, a repeat changes nothing, nothing is deleted', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const a = await choice(c, 'lead_source', 'start_rule', { sortOrder: 7 });
      expect(a.unchanged).toBe(false);
      expect((await choice(c, 'lead_source', 'start_rule', { sortOrder: 7 })).unchanged).toBe(true);
      const rows = (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_current)::int AS cur FROM v_dial_reason_choice WHERE kind_code = 'lead_source' AND code = 'start_rule'`)).rows[0];
      expect(rows.cur).toBe(1);
      expect(rows.n).toBeGreaterThanOrEqual(2);
      await expect(setReasonChoiceInTx(tx(c), { kindCode: 'zzz_kind', code: 'x', label: 'x' })).rejects.toBeInstanceOf(DialMapError);
    });
  });

  it('setSaidBackInTx takes the direction (kept when left out); a non-customer move is refused', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const t = tx(c);
      const says = (await said(c, 'quiz_answer', 'v7_q1_a'))!;
      expect((await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: says, moveCode: null })).unchanged).toBe(true);
      expect((await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: says, moveCode: 'bolder' })).unchanged).toBe(false);
      expect((await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: says })).unchanged).toBe(true);
      expect((await c.query(`SELECT move_code FROM v_dial_said_back WHERE is_current AND fact_code = 'v7_q1_a'`)).rows[0].move_code).toBe('bolder');
      await expect(setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: says, moveCode: 'quiz_result' })).rejects.toBeInstanceOf(DialMapError);
    });
  });

  it('updateCoffeeInTx takes mapLine; a roaster name is refused; a map coffee with none is reported by check 16', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      await ensureRev2(c);
      expect((await dialMapChecks(c)).find(k => k.id === 16)!.pass).toBe(true);
      const id = await placedId(c, 'Brazil');
      const roaster = (await c.query<{ roaster_name: string }>(`SELECT roaster_name FROM v_coffee WHERE id = $1`, [id])).rows[0].roaster_name;
      await expect(savepoint(() => updateCoffeeInTx(tx(c), { coffeeId: id, mapLine: `By ${roaster}` }))).rejects.toBeInstanceOf(CatalogError);
      await updateCoffeeInTx(tx(c), { coffeeId: id, mapLine: null });
      expect((await dialMapChecks(c)).find(k => k.id === 16)!.details).toContain('Brazil');
    });
  });

  it('the folded lookups return the same row by sign-in id or profile id', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureRev2(c);
      const p = await person(c, P81);
      const uid = (await c.query<{ firebase_uid: string }>(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [p.userId])).rows[0].firebase_uid;
      const [k1, k2] = [await reads.getCupboardCoffee({ uid }, c), await reads.getCupboardCoffee({ profileId: p.userId }, c)];
      expect(k1?.code).toBe('counter_culture');
      expect(k2).toEqual(k1);
      const [f1, f2] = [await reads.getCoffeeFeeling({ uid }, c), await reads.getCoffeeFeeling({ profileId: p.userId }, c)];
      expect(f1?.code).toBe('gentler');
      expect(f2).toEqual(f1);
    });
  });
});
