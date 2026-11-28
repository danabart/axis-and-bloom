// Ella's Bloom Map 15 (2026-11-27), Part D: every card says something about
// you, and two steps from Tiger Stripe. With a usable quiz every card speaks
// about the customer: the late kinds after the reuse pass and treat,
// family_lean (the family the coffee leans toward) then own_family, neither
// ever a lead; the opposite direction last (dial_step_opposite_last); a tag on
// every card relative to the spot (same_family, joined_by_step,
// leans_to_spot_family, other_direction; "Your spot"); the "Looking at" card
// built like a step card; with a quiz taken by someone else, no sentence about
// the customer from it (the top card is the rule's coffee line) while their own
// setup feeling still speaks. No customer text says "elsewhere". Test DB only,
// every test inside a rolled-back transaction; marked 'Zzz Map15' fixtures.
// Dana's production pages (CLOSING_REPORT_15.md, "Item 5 and item 6 again")
// are pinned word for word.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_15_CARDS_ABOUT_YOU.md
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { setReasonChoiceInTx } from './dialPlacementService.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyRev2 } from '../scripts/ellaMapReasonsRev2_2026_11_23.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';
import { applyComparisons } from '../scripts/ellaMapStepComparisons_2026_11_25.js';
import { applyCards, planCards, DATA_1, LABEL_TAIL } from '../scripts/ellaMapCardsAboutYou_2026_11_27.js';
import { applyMeasured } from '../scripts/ellaMapMeasuredFromSpot_2026_11_27.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

/** The words of briefs 9, 10 and 12, then this brief's rows and steps (published in the rollback). */
async function ensure15(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map15 test ${randomUUID()}` });
  await applyRev2(tx(c));
  await applyComparisons(tx(c));
  await applyCards(tx(c));
  // Ella map 16 (2026-11-27): five rows off, one step word renamed (published in the rollback when needed)
  await applyMeasured(tx(c));
}

interface Fixture {
  primary: string; scores: Record<string, number>; answers: string[];
  branch?: string | null; proxy?: boolean; feeling?: string | null;
}
async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map15') RETURNING id`, [`zzz-map15-${randomUUID()}`])).rows[0].id;
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;
/** A completed quiz, as dialMap10 writes one (self-taken unless proxy). */
async function person(c: pg.PoolClient, f: Fixture): Promise<{ userId: string; sessionId: string }> {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = $1`, [f.primary])).rows[0].id;
  const ids = [] as string[];
  for (const a of f.answers) ids.push(await answerId(c, a));
  const branch = f.branch ? await answerId(c, f.branch) : null;
  const takenBy = f.proxy ? await newProfile(c) : null;
  const context = { archetype: f.primary, scores: f.scores, branchedFrom: null, answerIds: ids };
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id, taken_by_user_id)
     VALUES ($1, $2, $3, timezone('utc', now()), $4, $5) RETURNING id`,
    [userId, arch, JSON.stringify(context), branch, takenBy])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', $2)`, [sessionId, f.primary]);
  if (f.feeling) {
    await c.query(
      `INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, 'coffee_feeling', $3, 'set')`,
      [userId, `zzz-map15-${randomUUID()}`, JSON.stringify(f.feeling)]);
  }
  return { userId, sessionId };
}
const placedId = async (c: pg.PoolClient, mapName: string) =>
  (await c.query<{ coffee_id: number }>(`SELECT p.coffee_id FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id WHERE a.map_name = $1`, [mapName])).rows[0].coffee_id;

const DANA_ANSWERS = ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_c'];
/** Dana's account on production: the Chocolate & Nutty quiz, Founder's pick on Tiger Stripe, the feeling "happy" (never said back). */
async function danaLike(c: pg.PoolClient, answers = DANA_ANSWERS, spotName = 'Tiger Stripe') {
  const p = await person(c, { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 9 }, branch: 'v7_branch_cn_stay', answers, feeling: 'happy' });
  const tiger = await placedId(c, spotName);
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, picked_coffee_id, source, source_id, inputs)
     SELECT $1, timezone('utc', now()) - interval '2 hours', v.id, m.id, $2, 'quiz', $3, $4
       FROM dial_map_version v, dial_move m WHERE v.activated_at IS NOT NULL AND v.retired_at IS NULL AND m.code = 'quiz_result'`,
    [p.userId, tiger, p.sessionId, JSON.stringify({ rule: 'derived', quiz: { session_id: p.sessionId } })]);
  return p;
}
const page = async (c: pg.PoolClient, userId: string, at?: string) =>
  match.steps(userId, c, { withBasis: true, readAsRule: true, at: at ? await placedId(c, at) : undefined });
/** [name, tag, isLead, choice, text] per card, the lead first, as /map shows them */
const cards = (r: match.MapStepsResult) => r.steps.map(s => [s.name, s.tag, s.isLead, s.basis?.choice ?? null, s.text]);
const choice = (c: pg.PoolClient, kindCode: string, code: string, patch: { sortOrder?: number; isActive?: boolean }) =>
  setReasonChoiceInTx(tx(c), { kindCode, code, ...patch, adminUid: 'zzz-map15' });

const SAME = 'Same family as your spot';
const CLOSE = 'Close to your spot';
const SPOT = 'Your spot';
const ONE = 'One step from your spot';
const OUT = (n: number) => `Outside your comfort zone · ${n} steps from your spot`;
const A1 = 'Coffee should feel like a reward for you: warm, rich, comforting.';
const A2 = 'A little bitterness tastes serious to you.';
const A3 = 'For you, a good cup is strong and satisfying.';
const A4 = 'A coffee with no bitterness would bother you.';
const A5 = "Coffee is a daily ritual for you, and you're particular about it.";
const A6 = 'You taste a black coffee first, then make it richer.';
const TREAT = "Next to your coffee, you'd reach for something fresh and lively.";
// Ella map 16: the late kinds on a spot page whose spot is Fabricator (all on; family_lean off; both off), pinned from the run
const LATE = [
  [['Tiger Stripe', 'strongest_support'], ['Geometric', 'treat'], ['Brazil', 'family_lean'], ['Benchmark', 'family_lean']],
  [['Tiger Stripe', 'strongest_support'], ['Geometric', 'treat'], ['Brazil', 'own_family'], ['Benchmark', 'own_family']],
  [['Tiger Stripe', 'strongest_support'], ['Geometric', 'treat'], ['Brazil', null], ['Benchmark', null]],
];
const OPP_ON = ['family_lean', ['v7_branch_cn_stay']];

describe('the two pairs: one change from Tiger Stripe (Data 1)', () => {
  it('four steps through setStepInTx, basis our_guess, published once; no placement moves; a second run writes nothing', async () => {
    await withRollback(async ({ client: c }) => {
      const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
      if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map15 test ${randomUUID()}` });
      await applyRev2(tx(c));
      await applyComparisons(tx(c));
      const shape = `SELECT coffee_id, archetype_code::text, ring, lane_code, size FROM v_dial_placement ORDER BY coffee_id`;
      const before = JSON.stringify((await c.query(shape)).rows);
      await applyCards(tx(c));
      expect(JSON.stringify((await c.query(shape)).rows)).toBe(before);
      const again = await applyCards(tx(c));
      expect(again.written).toBe(0);
      expect(again.published).toBeNull();
      const av = (await c.query<{ label: string }>(`SELECT label FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0].label;
      // Ella map 16 publishes after this brief (a renamed step word): the active version is this brief's or the next one's
      expect(av.endsWith(LABEL_TAIL) || av.endsWith('(Ella map 16)')).toBe(true);
      const tiger = await placedId(c, 'Tiger Stripe');
      const out = (await c.query<{ to_coffee_name: string }>(`SELECT to_coffee_name FROM v_dial_step WHERE on_active_map AND from_coffee_id = $1`, [tiger])).rows;
      expect(out.length).toBe(5);
      for (const d of DATA_1) {
        const s = (await c.query(`SELECT button_word, move_code, basis_code, customer_line FROM v_dial_step WHERE on_active_map AND from_coffee_id = $1 AND to_coffee_id = $2`,
          [await placedId(c, d.from), await placedId(c, d.to)])).rows[0];
        expect(s).toEqual({ button_word: d.word, move_code: d.move, basis_code: 'our_guess', customer_line: d.line });
      }
      // no step between Tiger Stripe and Benchmark
      const bench = await placedId(c, 'Benchmark');
      expect((await c.query(`SELECT 1 FROM v_dial_step WHERE on_active_map AND ((from_coffee_id = $1 AND to_coffee_id = $2) OR (from_coffee_id = $2 AND to_coffee_id = $1))`, [tiger, bench])).rowCount).toBe(0);
      const plan = await planCards(tx(c));
      expect(plan.rows.filter(r => r.action === 'write')).toEqual([]);
    });
  });
});

describe("Dana's pages, word for word (CLOSING_REPORT_15, with Dana's answers)", () => {
  it('on her spot: five steps from Tiger Stripe, each answer once; no tags (Ella map 16: the spot_relation rows are off)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await danaLike(c);
      const r = await page(c, p.userId);
      expect(r.firstBag!.labelCode).toBe('founder_pick');
      expect(r.firstBag!.tag ?? null).toBeNull();
      expect(r.firstBag!.text).toBe(`${A1} ${A2} Chocolate first, with a little lift. Built for espresso.`);
      expect(cards(r)).toEqual([
        ['Blossom', null, true, 'strongest_support', `${A3} A darker roast than Tiger Stripe, with a fuller body.`],
        ['Geometric', null, false, 'treat', `${TREAT} More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it.`],
        ['The Daily', null, false, 'family', `${A5} Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.`],
        ['Fabricator', null, false, 'family', `${A6} Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.`],
        ['The Waverly', null, false, 'family', `${A4} Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange.`],
      ]);
      expect(r.steps.find(s => s.name === 'Geometric')!.basis!.tagCode).toBeNull();
      const facts = [...r.firstBag!.basis!.factCodes, ...r.steps.flatMap(s => s.basis!.factCodes)];
      expect(new Set(facts).size).toBe(facts.length);
    });
  });

  it('looking at Fabricator (Ella map 16): its spot-page card; each step card its line with its distance from the spot; Tiger Stripe is "Your spot"; no lead', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await danaLike(c);
      const r = await page(c, p.userId, 'Fabricator');
      expect(r.lookingAt).toBe(true);
      expect(r.firstBag!.labelCode).toBe('looking_at_title');
      expect(r.firstBag!.tag).toBe(ONE);
      expect(r.firstBag!.basis!.choice).toBe('family');
      expect(r.firstBag!.text).toBe(`${A6} Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.`);
      expect(cards(r)).toEqual([
        ['Geometric', ONE, false, null, 'Made from the same coffees as Fabricator, with more fruit, and sweeter.'],
        ['Brazil', OUT(2), false, null, 'Simpler than Fabricator: chocolate, almond, honey.'],
        ['Tiger Stripe', SPOT, false, null, 'More body than Fabricator, with cherry where the citrus was. Built for espresso.'],
        ['Benchmark', OUT(2), false, null, 'Rounder than Fabricator: pure chocolate, softer, no citrus.'],
      ]);
      expect(r.steps.find(s => s.name === 'Brazil')!.basis!.tagCode).toBe('outside_comfort');
    });
  });

  it('looking at Benchmark, The Daily and The Village', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await danaLike(c);
      const b = await page(c, p.userId, 'Benchmark');
      // Ella map 16: two steps out, the summary and the coffee's own line, no answer of hers
      expect([b.firstBag!.tag, b.firstBag!.basis!.choice, b.firstBag!.text]).toEqual([OUT(2), null,
        'Less fruit, and lighter. This is the cup where nothing sticks out: pure chocolate, round and soft.']);
      expect(cards(b)).toEqual([
        ['The Daily', ONE, false, null, 'The same chocolate as Benchmark, livelier, with a bit more bite.'],
        ['La Familia', OUT(2), false, null, 'Lighter in the cup than Benchmark: caramel and honey, with a little clementine.'],
        ['Fabricator', ONE, false, null, 'More going on than Benchmark: hazelnut, a little citrus, a dry finish.'],
      ]);
      const d = await page(c, p.userId, 'The Daily');
      expect([d.firstBag!.tag, d.firstBag!.text]).toEqual([ONE, `${A5} Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite.`]);
      expect(cards(d)).toEqual([
        ['Benchmark', OUT(2), false, null, 'The same chocolate as The Daily, rounder and softer.'],
        ['Amsterdam', OUT(2), false, null, 'A step darker than The Daily: smoother, with less acidity.'],
        ['Tiger Stripe', SPOT, false, null, 'The Daily with a fruit edge: chocolate first, cherry behind. Built for espresso.'],
      ]);
      const v = await page(c, p.userId, 'The Village');
      expect([v.firstBag!.tag, v.firstBag!.basis!.choice, v.firstBag!.text]).toEqual([OUT(3), null,
        'More fruit, lighter, and more delicate. Floral, with apple blossom and grapefruit.']);
      expect(cards(v)).toEqual([
        ['Cafè Feminista', OUT(4), false, null, 'Creamier than The Village: papaya and candied coconut.'],
        ['La Familia', OUT(2), false, null, 'Softer and sweeter than The Village: caramel and honey.'],
      ]);
    });
  });
});

describe('the late kinds: family_lean and own_family', () => {
  // Ella map 16: the late kinds serve step cards on a spot page only (no answer is quoted on a card while looking),
  // and own_family is off; these read a spot page whose spot is Fabricator, with own_family on again in the rollback.
  it('never decide a lead; each is skipped when its row is off; with both off a card carries its line alone', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      await choice(c, 'step_support', 'own_family', { isActive: true });
      const p = await danaLike(c, DANA_ANSWERS, 'Fabricator');
      const pages = [await page(c, p.userId)];
      await choice(c, 'step_support', 'family_lean', { isActive: false });
      pages.push(await page(c, p.userId));
      await choice(c, 'step_support', 'own_family', { isActive: false });
      pages.push(await page(c, p.userId));
      for (const r of pages) for (const s of r.steps.filter(x => x.isLead)) expect(['family_lean', 'own_family']).not.toContain(s.basis!.choice);
      const choices = pages.map(r => r.steps.map(s => [s.name, s.basis!.choice]));
      expect(choices).toEqual(LATE);
      for (const s of pages[2].steps.filter(x => x.basis!.choice === null)) expect(s.text.replace(/\.$/, '')).toBe((s.line ?? '').replace(/\.$/, ''));
    });
  });

  it('the opposite direction last (dial_step_opposite_last): on, a used answer with no direction beats an unused bolder one on a gentler step; off, unused first', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      // Chocolate & Nutty answers argue bolder (q2_a, q4_a, q5_a) or none (the branch); q1_c and q3_c are Fruity
      // Ella map 16: on a spot page (spot Fabricator); while looking no step card quotes an answer
      const p = await danaLike(c, ['v7_q1_c', 'v7_q2_a', 'v7_q3_c', 'v7_q4_a', 'v7_q5_a', 'v7_q6_c'], 'Fabricator');
      const on = await page(c, p.userId);
      const brazilOn = on.steps.find(s => s.name === 'Brazil')!; // gentler; leans Chocolate & Nutty
      expect([brazilOn.basis!.choice, brazilOn.basis!.factCodes]).toEqual(OPP_ON);
      await setParameterInTx(tx(c), { key: 'dial_step_opposite_last', value: 0, adminId: 'zzz-map15' });
      const off = await page(c, p.userId);
      const brazilOff = off.steps.find(s => s.name === 'Brazil')!;
      expect(brazilOff.basis!.choice).toBe('family_lean');
      expect(brazilOff.basis!.factCodes).not.toEqual(['v7_branch_cn_stay']);
      const opposite = (await c.query<{ move_code: string | null }>(
        `SELECT move_code FROM v_dial_said_back WHERE is_current AND source_code = 'quiz_answer' AND fact_code = $1`, [brazilOff.basis!.factCodes[0]])).rows[0].move_code;
      expect(opposite).toBe('bolder');
    });
  });
});

describe('the tag, relative to the spot (spot_relation rows)', () => {
  it('first match wins in row order; a row switched off is skipped; the spot as a card is "Your spot"', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await danaLike(c);
      const tagOf = (r: match.MapStepsResult, name: string) => r.steps.find(s => s.name === name)!.tag;
      // Ella map 16: the rows are off and tag only the spot page's cards; on again in the rollback
      for (const code of ['same_family', 'joined_by_step', 'leans_to_spot_family', 'other_direction']) await choice(c, 'spot_relation', code, { isActive: true });
      expect(tagOf(await page(c, p.userId), 'The Daily')).toBe(SAME);
      await choice(c, 'spot_relation', 'same_family', { isActive: false });
      const r1 = await page(c, p.userId);
      expect(tagOf(r1, 'The Daily')).toBe(CLOSE); // joined by the new step
      expect(r1.steps.find(s => s.name === 'The Daily')!.basis!.tagCode).toBe('joined_by_step');
      await choice(c, 'spot_relation', 'joined_by_step', { isActive: false });
      const r2 = await page(c, p.userId);
      // Geometric is Fruity and leans toward Chocolate & Nutty, Tiger Stripe's family: the next row holds
      expect(tagOf(r2, 'Geometric')).toBe(CLOSE);
      expect(r2.steps.find(s => s.name === 'Geometric')!.basis!.tagCode).toBe('leans_to_spot_family');
      await choice(c, 'spot_relation', 'same_family', { isActive: true });
      await choice(c, 'spot_relation', 'other_direction', { sortOrder: 0 });
      const r3 = await page(c, p.userId);
      expect(tagOf(r3, 'Blossom')).toBe('A different direction: Chocolate & Nutty');
      // while looking, the tag is the distance from the spot whatever these rows say (Ella map 16)
      const r4 = await page(c, p.userId, 'Fabricator');
      expect([tagOf(r4, 'Brazil'), tagOf(r4, 'Tiger Stripe'), r4.firstBag!.tag]).toEqual([OUT(2), SPOT, ONE]);
    });
  });
});

describe('a quiz taken by someone else (G2.19, Dana Q9)', () => {
  it("the top card is the rule's coffee line only, no card speaks from that quiz, the customer's own feeling still does (Ella map 16: no tags on the spot page)", async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await person(c, { primary: 'Fruity', scores: { Fruity: 9 }, branch: 'v7_branch_fruity_stay', proxy: true, feeling: 'gentler',
        answers: ['v7_q1_c', 'v7_q2_c', 'v7_q3_c', 'v7_q4_c', 'v7_q5_c', 'v7_q6_c'] });
      const r = await page(c, p.userId);
      const start = (await c.query<{ coffee_line: string | null; customer_reason: string }>(
        `SELECT coffee_line, customer_reason FROM v_dial_start WHERE quiz_session_id = $1`, [p.sessionId])).rows[0];
      expect(r.firstBag!.labelCode).toBe('founder_pick');
      expect(r.firstBag!.basis!.factCodes).toEqual([]);
      expect(r.firstBag!.text).toBe(start.coffee_line);
      expect(r.firstBag!.text).not.toBe(start.customer_reason);
      const quizCodes = (await c.query<{ answer_code: string }>(`SELECT answer_code FROM v_dial_quiz_answer WHERE quiz_session_id = $1`, [p.sessionId])).rows.map(x => x.answer_code);
      for (const s of r.steps) {
        expect(s.tag).toBeNull();
        for (const f of s.basis!.factCodes) expect(quizCodes).not.toContain(f);
      }
      // the setup feeling is the customer's own: a gentler step leads with it
      const feeling = (await c.query<{ says_back: string }>(`SELECT says_back FROM v_dial_said_back WHERE is_current AND source_code = 'coffee_feeling' AND fact_code = 'gentler'`)).rows[0].says_back;
      const gentler = r.steps.filter(s => s.basis!.factCodes.includes('gentler'));
      if (gentler.length) expect(gentler[0].text.startsWith(feeling)).toBe(true);
    });
  });
});

describe('no card rules a coffee out', () => {
  it('with a usable quiz no page prints no_support, and no customer text says "elsewhere"', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const p = await danaLike(c);
      const others: Fixture[] = [
        { primary: 'Balanced', scores: { 'Balanced & Sweet': 8, Fruity: 1 }, answers: ['v7_q1_c', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'] },
        { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 5, 'Balanced & Sweet': 3, Fruity: 1 }, answers: ['v7_q1_b', 'v7_q2_b', 'v7_q3_c', 'v7_q4_a', 'v7_q5_a', 'v7_q6_b'] },
        { primary: 'Fruity', scores: { Fruity: 8, 'Chocolate & Nutty': 1 }, answers: ['v7_q1_a', 'v7_q2_c', 'v7_q3_c', 'v7_q4_c', 'v7_q5_c', 'v7_q6_b'] },
      ];
      const pages = [await page(c, p.userId)];
      for (const at of ['Fabricator', 'Benchmark', 'The Daily', 'The Village', 'Brazil', 'Indonesia', 'La Familia']) pages.push(await page(c, p.userId, at));
      for (const f of others) pages.push(await page(c, (await person(c, f)).userId));
      for (const r of pages) {
        for (const t of [r.firstBag?.text ?? '', ...r.steps.map(s => s.text)]) expect(t.toLowerCase()).not.toContain('elsewhere');
        for (const b of [r.firstBag?.basis, ...r.steps.map(s => s.basis)]) expect(b?.copyCodes ?? []).not.toContain('no_support');
        // a usable quiz: every step card on a spot page speaks about the customer (a start rule's lead carries the rule's
        // own lead line, brief 10); Ella map 16: while looking, step cards are their line alone
        if (!r.lookingAt) for (const s of r.steps.filter(x => x.basis!.choice !== 'start_rule')) expect(s.basis!.factCodes.length).toBeGreaterThan(0);
        else for (const s of r.steps) expect(s.basis!.factCodes).toEqual([]);
      }
    });
  }, 900_000);
});

describe('integrity', () => {
  it('check 15 knows every new row; the copy and the parameter are present', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure15(c);
      const checks = await dialMapChecks(c);
      const c15 = checks.find(x => x.id === 15)!;
      expect(c15.pass).toBe(true);
      const failed = checks.filter(x => !x.pass).map(x => `${x.id}: ${(x.details ?? []).join(' ')}`).join(' | ');
      expect(failed).not.toMatch(/tag_|steps_title_from|dial_step_opposite_last/);
    });
  });
});
