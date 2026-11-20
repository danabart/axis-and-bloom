// Ella's Bloom Map 9 (2026-11-20), Part D: the composed text on /map, the
// three writers and the three integrity checks.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md
//
// Every case runs inside withRollback. When the database has no said-back row
// yet, the seed script's applyReasons enters Data 1 to 3 and publishes (rolled
// back with the case). Fixture people are marked "Zzz Map9". Words are read
// from the rows (dial_customer_copy, dial_said_back), never typed in here,
// except the four Data 4 people's expected text, which is what Dana approved.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { setSaidBackInTx, setStartRuleInTx, setStepInTx, DialMapError } from './dialPlacementService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

async function ensureReasons(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map9 test ${randomUUID()}` });
}

interface Fixture {
  primary: string;                  // coffee_archetype.name of the stored result
  scores: Record<string, number>;   // as stored in context_data.scores (display names)
  answers: string[];                // answer codes stored in answerIds (none = an old session)
  branch?: string | null;           // the branch answer code
  branchedFrom?: string | null;
  proxy?: boolean;                  // taken by another person
  kitchen?: string | null;          // cupboard_coffee value code
  feeling?: string | null;          // coffee_feeling value code
}

async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map9') RETURNING id`, [`zzz-map9-${randomUUID()}`])).rows[0].id;
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;

/** A marked test person with one quiz session (and setup answers) as the fixture says. */
async function person(c: pg.PoolClient, f: Fixture): Promise<{ userId: string; sessionId: string }> {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = $1`, [f.primary])).rows[0].id;
  const ids = [] as string[];
  for (const a of f.answers) ids.push(await answerId(c, a));
  const branch = f.branch ? await answerId(c, f.branch) : null;
  const takenBy = f.proxy ? await newProfile(c) : null;
  const context: Record<string, unknown> = { archetype: f.primary, scores: f.scores, branchedFrom: f.branchedFrom ?? null };
  if (ids.length) context.answerIds = ids;
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
      [userId, `zzz-map9-${randomUUID()}`, field, JSON.stringify(value)]);
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
const coffeeId = async (c: pg.PoolClient, name: string) =>
  (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement WHERE coffee_name = $1`, [name])).rows[0].coffee_id;
const fill = (t: string, v: Record<string, string>) => Object.entries(v).reduce((s, [k, x]) => s.replaceAll(`{${k}}`, x), t);

const BAL = { primary: 'Balanced' };
const ALL_BALANCED = ['v7_q1_b', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'];

describe('the first bag (B2)', () => {
  it('all answers in one family: two quoted, no also-said, then the rule coffee_line', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const copy = await copyOf(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      const a = await said(c, 'quiz_answer', 'v7_q5_b'), b = await said(c, 'quiz_answer', 'v7_q2_b');
      expect(r.firstBag!.text.startsWith(fill(copy.told_us_two, { a: a!, b: b! }))).toBe(true);
      expect(r.firstBag!.text).not.toContain(fill(copy.also_said, { c: '' }).replace('.', '').trim());
      expect(r.firstBag!.isFounderPick).toBe(true);
      expect(r.firstBag!.basis!.factCodes).toEqual(['v7_q5_b', 'v7_q2_b']);
    });
  });

  it('a split result adds the also-said sentence (the top answer for another family)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const copy = await copyOf(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 8, Fruity: 1 }, answers: ['v7_q1_c', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'] });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      expect(r.firstBag!.text).toContain(fill(copy.also_said, { c: (await said(c, 'quiz_answer', 'v7_q1_c'))! }));
    });
  });

  it('no stored answers, a proxy-taken quiz, and Q6 alone all fall back to customer_reason, nothing quoted', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      for (const f of [
        { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: [] },
        { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED, proxy: true },
        { ...BAL, scores: { 'Balanced & Sweet': 1 }, answers: ['v7_q6_b'] },
      ] as Fixture[]) {
        const p = await person(c, f);
        await quizDecide(c, p);
        const r = await page(c, p.userId);
        expect(r.firstBag!.text).toBe(r.firstBag!.reason);
        expect(r.firstBag!.basis!.factCodes).toEqual([]);
        for (const s of r.steps) expect(s.basis!.factCodes.filter(x => x.startsWith('v7_'))).toEqual([]);
      }
    });
  });

  it('the kitchen sentence opens the text for a quotable brand; a brand with no row (a partner, "nothing") is never quoted', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const copy = await copyOf(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED, kitchen: 'counter_culture' });
      await quizDecide(c, p);
      expect((await page(c, p.userId)).firstBag!.text.startsWith(fill(copy.kitchen, { brand: (await said(c, 'cupboard_coffee', 'counter_culture'))! }))).toBe(true);
      for (const brand of ['joe_bean', 'nothing', 'local_roaster']) {
        expect(await said(c, 'cupboard_coffee', brand)).toBeUndefined();
        const q = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED, kitchen: brand });
        await quizDecide(c, q);
        expect((await page(c, q.userId)).firstBag!.basis!.copyCodes).not.toContain('kitchen');
      }
    });
  });

  it('C1: an Earthy result quotes its branch answer first and counts its Chocolate & Nutty answers as its own', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const p = await person(c, {
        primary: 'Earthy', branch: 'v7_branch_cn_earthy', scores: { 'Chocolate & Nutty': 9 },
        answers: ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_a'],
      });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      expect(r.firstBag!.basis!.factCodes).toEqual(['v7_branch_cn_earthy', 'v7_q5_a']);
    });
  });
});

describe('the lead and the other steps (B2)', () => {
  it('a feeling that names a direction with a matching step leads, with asked_for; the opposite step says step_against', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const copy = await copyOf(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 4, 'Chocolate & Nutty': 3, Fruity: 2 },
        answers: ['v7_q1_b', 'v7_q2_c', 'v7_q3_b', 'v7_q4_b', 'v7_q5_a', 'v7_q6_a'], feeling: 'bolder' });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      const lead = r.steps.find(s => s.isLead)!;
      expect(r.steps.filter(s => s.isLead)).toHaveLength(1);
      expect(r.steps[0].isLead).toBe(true);
      expect(lead.text.startsWith(fill(copy.asked_for, { feeling: (await said(c, 'coffee_feeling', 'bolder'))! }))).toBe(true);
      const moves = (await c.query<{ id: number; move_code: string | null }>(`SELECT id, move_code FROM v_dial_step WHERE on_active_map`)).rows;
      expect(moves.find(m => m.id === lead.stepId)!.move_code).toBe('bolder');
      const gentle = r.steps.find(s => moves.find(m => m.id === s.stepId)!.move_code === 'gentler')!;
      expect(gentle.text.endsWith(copy.step_against)).toBe(true);
    });
  });

  it('a feeling with no matching step leaves the rule lead in place', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      // Floral starts at The Village, whose two steps both answer "different"
      const p = await person(c, { primary: 'Floral', branchedFrom: 'Fruity', branch: 'v7_branch_fruity_floral', scores: { Fruity: 9 },
        answers: ['v7_q1_c', 'v7_q2_c', 'v7_q3_c', 'v7_q4_c', 'v7_q5_c', 'v7_q6_c'], feeling: 'gentler' });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      const rule = (await c.query<{ lead_to_coffee_id: number }>(`SELECT lead_to_coffee_id FROM v_dial_start_rule WHERE is_current AND family_code = 'floral'`)).rows[0];
      expect(r.steps.find(s => s.isLead)!.coffeeId).toBe(rule.lead_to_coffee_id);
    });
  });

  it('step_away: a destination family the customer gave at most dial_away_max_points to, and not their own', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const copy = await copyOf(c);
      // person 85's answers: La Familia, Geometric (Fruity, 1 point) moves away, Benchmark (their own) does not
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 8, Fruity: 1 }, answers: ['v7_q1_c', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'] });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      expect(r.steps.find(s => s.name === 'Geometric')!.text.endsWith(copy.step_away)).toBe(true);
      expect(r.steps.find(s => s.name === 'Benchmark')!.text.endsWith(copy.step_away)).toBe(false);
    });
  });

  it('no quiz: after a step and with no quiz, the notes and when_line only, no lead, no founder label', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED });
      await quizDecide(c, p);
      const first = await page(c, p.userId);
      const step = first.steps[0];
      await match.decide({ userId: p.userId, trigger: 'hop', move: 'step', pickedCoffeeId: step.coffeeId, source: 'map', sourceId: randomUUID() }, c);
      // the session moves to another profile inside the rollback: the customer now has no quiz
      await c.query(`UPDATE quiz_session SET user_id = $2 WHERE id = $1`, [p.sessionId, await newProfile(c)]);
      const r = await page(c, p.userId);
      expect(r.firstBag).toBeNull();
      expect(r.steps.some(s => s.isLead)).toBe(false);
      for (const s of r.steps) expect(s.basis!.factCodes).toEqual([]);
    });
  });

  it('Read it as: a customer with no decision is read from the start rule and nothing is written', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED });
      expect((await page(c, p.userId)).position).toBeNull();
      const before = (await c.query(`SELECT count(*)::int AS n FROM customer_match_decision`)).rows[0].n;
      const r = await page(c, p.userId, { withBasis: true, readAsRule: true });
      expect(r.readAs).toBe('start_rule');
      expect(r.position!.name).toBeTruthy();
      expect(r.firstBag!.text).not.toBe(r.firstBag!.reason);
      expect((await c.query(`SELECT count(*)::int AS n FROM customer_match_decision`)).rows[0].n).toBe(before);
    });
  });

  // v7_q1_b has no phrase on purpose (Dana 2026-11-20, Part E): the next Balanced answer, v7_q3_b, is quoted instead
  it('person 81 (Data 4) reads as Dana approved', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 4, 'Chocolate & Nutty': 3, Fruity: 2 },
        answers: ['v7_q1_b', 'v7_q2_c', 'v7_q3_b', 'v7_q4_b', 'v7_q5_a', 'v7_q6_a'], kitchen: 'counter_culture', feeling: 'gentler' });
      await quizDecide(c, p);
      const r = await page(c, p.userId);
      expect(r.position!.name).toBe('Benchmark');
      expect(r.firstBag!.text).toBe('You have Counter Culture Coffee in your kitchen. You told us too bitter is what would bother you most, and you smooth a black coffee before you try it. You also said a little bitterness tastes serious to you. This is the cup where nothing sticks out, and it works however you make it.');
      expect(r.steps.map(s => [s.name, s.isLead, s.text])).toEqual([
        ['La Familia', true, 'You asked for something gentler than what you drink now. Caramel and honey with a little clementine. Lighter in the cup.'],
        ['The Daily', false, 'If you want more bite. The same chocolate, livelier, with a bit more bite. This goes the other way from what you asked for.'],
        ['Fabricator', false, "If you're curious. Hazelnut, a little citrus, a dry finish."],
      ]);
      // the customer page reads the same text and no basis
      const plain = await match.steps(p.userId, c);
      expect(plain.firstBag!.text).toBe(r.firstBag!.text);
      expect(plain.firstBag!.basis).toBeUndefined();
      expect(plain.steps.every(s => s.basis === undefined)).toBe(true);
    });
  });

  it('a founder edit shows on the next read (said-back phrase)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const p = await person(c, { ...BAL, scores: { 'Balanced & Sweet': 9 }, answers: ALL_BALANCED });
      await quizDecide(c, p);
      await setSaidBackInTx(tx(c), { sourceCode: 'quiz_answer', factCode: 'v7_q5_b', saysBack: 'zzz edited phrase', adminUid: 'zzz-map9' });
      expect((await page(c, p.userId)).firstBag!.text).toContain('zzz edited phrase');
    });
  });
});

describe('the writers (B1)', () => {
  it('setSaidBackInTx supersedes and inserts; the same phrase changes nothing; clearing retires; an unknown fact is refused', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const t = tx(c);
      const a = await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: 'zzz one', adminUid: 'zzz' });
      expect(a.unchanged).toBe(false);
      expect((await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: 'zzz one', adminUid: 'zzz' })).unchanged).toBe(true);
      const cleared = await setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q1_a', saysBack: null, adminUid: 'zzz' });
      expect(cleared).toMatchObject({ id: null, unchanged: false, supersededId: a.id });
      const rows = (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_current)::int AS cur FROM v_dial_said_back WHERE fact_code = 'v7_q1_a'`)).rows[0];
      expect(rows.cur).toBe(0);
      expect(rows.n).toBeGreaterThanOrEqual(2); // nothing deleted
      await expect(setSaidBackInTx(t, { sourceCode: 'quiz_answer', factCode: 'v7_q9_z', saysBack: 'x' })).rejects.toBeInstanceOf(DialMapError);
    });
  });

  it('setStartRuleInTx and setStepInTx take the new fields; a repeat changes nothing; a lead off the steps is refused', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const t = tx(c);
      const r = (await c.query(`SELECT * FROM v_dial_start_rule WHERE is_current AND family_code = 'chocolate_nutty' ORDER BY priority DESC LIMIT 1`)).rows[0];
      const base = { familyCode: r.family_code, priority: r.priority, conditionCode: r.condition_code, alsoConditionCode: r.also_condition_code,
        coffeeId: r.coffee_id, adminLabel: r.admin_label, customerReason: r.customer_reason, notes: r.notes };
      // left out = kept
      expect((await setStartRuleInTx(t, base)).unchanged).toBe(true);
      const w = await setStartRuleInTx(t, { ...base, coffeeLine: 'zzz line' });
      expect(w.unchanged).toBe(false);
      expect((await setStartRuleInTx(t, { ...base, coffeeLine: 'zzz line' })).unchanged).toBe(true);
      const kept = (await c.query(`SELECT lead_to_coffee_id FROM v_dial_start_rule WHERE id = $1`, [w.id])).rows[0];
      expect(kept.lead_to_coffee_id).toBe(r.lead_to_coffee_id);
      await expect(setStartRuleInTx(t, { ...base, leadToCoffeeId: await coffeeId(c, 'The Village') })).rejects.toMatchObject({ code: 'LEAD_NOT_A_STEP' });

      const s = (await c.query(`SELECT * FROM v_dial_step WHERE is_current AND is_shown ORDER BY id LIMIT 1`)).rows[0];
      const sb = { fromCoffeeId: s.from_coffee_id, toCoffeeId: s.to_coffee_id, buttonWord: s.button_word, customerLine: s.customer_line, basisCode: s.basis_code, isShown: s.is_shown };
      expect((await setStepInTx(t, sb)).unchanged).toBe(true);
      const sw = await setStepInTx(t, { ...sb, whenLine: 'zzz when', moveCode: null });
      expect(sw.unchanged).toBe(false);
      expect((await setStepInTx(t, { ...sb, whenLine: 'zzz when', moveCode: null })).unchanged).toBe(true);
      await expect(setStepInTx(t, { ...sb, moveCode: 'quiz_result' })).rejects.toBeInstanceOf(DialMapError);
    });
  });
});

describe('the integrity checks (A8)', () => {
  it('report an orphan phrase, a quotable answer with no phrase, and a lead off the steps', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureReasons(c);
      const ids = (await dialMapChecks(c)).filter(k => k.id >= 12);
      expect(ids.map(k => [k.id, k.pass])).toEqual([[12, true], [13, true], [14, true]]);
      // an orphan: a phrase for a code no current answer has (written directly, as an old row would be)
      await c.query(`INSERT INTO dial_said_back (source_id, fact_code, says_back, decided_by)
                     SELECT id, 'v6_retired_zzz', 'zzz', 'zzz' FROM dial_said_back_source WHERE code = 'quiz_answer'`);
      await setSaidBackInTx(tx(c), { sourceCode: 'quiz_answer', factCode: 'v7_q2_a', saysBack: null });
      // a lead that stops being a shown step
      const r = (await c.query(`SELECT coffee_id, lead_to_coffee_id FROM v_dial_start_rule WHERE is_current AND lead_to_coffee_id IS NOT NULL LIMIT 1`)).rows[0];
      const s = (await c.query(`SELECT * FROM v_dial_step WHERE is_current AND from_coffee_id = $1 AND to_coffee_id = $2`, [r.coffee_id, r.lead_to_coffee_id])).rows[0];
      await setStepInTx(tx(c), { fromCoffeeId: s.from_coffee_id, toCoffeeId: s.to_coffee_id, buttonWord: s.button_word, customerLine: s.customer_line, basisCode: s.basis_code, isShown: false });
      const after = (await dialMapChecks(c)).filter(k => k.id >= 12);
      expect(after.map(k => k.pass)).toEqual([false, false, false]);
      expect(after[0].details).toContain('quiz_answer v6_retired_zzz');
      expect(after[1].details!.some(d => d.endsWith('v7_q2_a'))).toBe(true);
    });
  });
});
