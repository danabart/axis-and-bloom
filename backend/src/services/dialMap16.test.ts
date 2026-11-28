// Ella's Bloom Map 16 (2026-11-27), Part D: every card is measured from your
// spot. While looking, each card's tag is its distance from the spot in steps
// (the fewest published, shown steps, in each step's direction); beyond the
// comfort zone (dial_path_comfort_zone_steps) it is "Outside your comfort
// zone". A one-step coffee's "Looking at" card is its spot-page step card word
// for word; further out the card is the summary of what is different (each
// kind of change once, repeats merged into much/far), shown only when clean
// (Dana Task 0 Q2: no change and its opposite; Q3: at most
// dial_path_max_changes kinds), then the coffee's own line. No quiz answer
// beyond the comfort zone or on a step card while looking; no lead while
// looking. The spot page is unchanged. Test DB only, every test inside a
// rolled-back transaction; marked 'Zzz Map16' fixtures.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_16_MEASURED_FROM_YOUR_SPOT.md
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import * as dialReads from './dialReads.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyRev2 } from '../scripts/ellaMapReasonsRev2_2026_11_23.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';
import { applyComparisons } from '../scripts/ellaMapStepComparisons_2026_11_25.js';
import { applyCards } from '../scripts/ellaMapCardsAboutYou_2026_11_27.js';
import { applyMeasured, planMeasured, OFF } from '../scripts/ellaMapMeasuredFromSpot_2026_11_27.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

/** The words of briefs 9, 10, 12 and 15, then this brief's rows (published in the rollback when needed). */
async function ensure16(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map16 test ${randomUUID()}` });
  await applyRev2(tx(c));
  await applyComparisons(tx(c));
  await applyCards(tx(c));
  await applyMeasured(tx(c));
}

async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map16') RETURNING id`, [`zzz-map16-${randomUUID()}`])).rows[0].id;
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;
const placedId = async (c: pg.PoolClient, mapName: string) =>
  (await c.query<{ coffee_id: number }>(`SELECT p.coffee_id FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id WHERE a.map_name = $1`, [mapName])).rows[0].coffee_id;

const DANA_ANSWERS = ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_c'];
/** Dana's account on production: the Chocolate & Nutty quiz, Founder's pick on Tiger Stripe, the feeling "happy" (never said back). */
async function danaLike(c: pg.PoolClient) {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = 'Chocolate & Nutty'`)).rows[0].id;
  const ids = [] as string[];
  for (const a of DANA_ANSWERS) ids.push(await answerId(c, a));
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id)
     VALUES ($1, $2, $3, timezone('utc', now()), $4) RETURNING id`,
    [userId, arch, JSON.stringify({ archetype: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 9 }, branchedFrom: null, answerIds: ids }), await answerId(c, 'v7_branch_cn_stay')])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', 'Chocolate & Nutty')`, [sessionId]);
  await c.query(
    `INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, 'coffee_feeling', $3, 'set')`,
    [userId, `zzz-map16-${randomUUID()}`, JSON.stringify('happy')]);
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, picked_coffee_id, source, source_id, inputs)
     SELECT $1, timezone('utc', now()) - interval '2 hours', v.id, m.id, $2, 'quiz', $3, $4
       FROM dial_map_version v, dial_move m WHERE v.activated_at IS NOT NULL AND v.retired_at IS NULL AND m.code = 'quiz_result'`,
    [userId, await placedId(c, 'Tiger Stripe'), sessionId, JSON.stringify({ rule: 'derived', quiz: { session_id: sessionId } })]);
  return userId;
}
const page = async (c: pg.PoolClient, userId: string, at?: string) =>
  match.steps(userId, c, { withBasis: true, readAsRule: true, at: at ? await placedId(c, at) : undefined });

const OUT = (n: number) => `Outside your comfort zone · ${n} steps from your spot`;
const ONE = 'One step from your spot';
/** Every sentence Dana's quiz and feeling may say about her (her said-back rows) */
const saidOf = async (c: pg.PoolClient) => (await c.query<{ says_back: string }>(`SELECT says_back FROM v_dial_said_back WHERE is_current AND is_quoted`)).rows.map(r => r.says_back);

const COPY = { path_join: ', ', path_last_join: ', and ', path_twice: 'much {word}', path_more: 'far {word}',
  tag_steps_one: ONE, tag_steps_many: '{n} steps from your spot', tag_outside_comfort: 'Outside your comfort zone · {steps}', tag_no_way: 'A different part of the map', tag_your_spot: 'Your spot' };
const OPP = new Map([['bolder', 'gentler'], ['gentler', 'bolder']]);
// two words are opposites when they are the two directions of one step pair (Dana 2026-11-28)
const WOPP = match.stepWordOpposites([{ from_coffee_id: 1, to_coffee_id: 2, button_word: 'Less fruit' }, { from_coffee_id: 2, to_coffee_id: 1, button_word: 'More fruit' }]);
const st = (w: string, m: string | null = null) => ({ button_word: w, move_code: m });

describe('the summary (pure)', () => {
  it('one word once, two the same, three the same, merged wherever they sit, joined by the copy rows', () => {
    expect(match.pathSummary([st('Bolder', 'bolder')], COPY, 3, OPP, WOPP).text).toBe('Bolder.');
    expect(match.pathSummary([st('Bolder', 'bolder'), st('Bolder', 'bolder')], COPY, 3, OPP, WOPP).text).toBe('Much bolder.');
    expect(match.pathSummary([st('Less fruit', 'different'), st('Bolder', 'bolder'), st('Bolder', 'bolder'), st('Bolder', 'bolder')], COPY, 3, OPP, WOPP).text).toBe('Less fruit, and far bolder.');
    // Dana Q1 (a): a repeat that is not adjacent is merged too
    expect(match.pathSummary([st('Lighter', 'gentler'), st('More fruit', 'different'), st('Lighter', 'gentler')], COPY, 3, OPP, WOPP).text).toBe('Much lighter, and more fruit.');
    expect(match.pathSummary([st('More fruit'), st('Lighter', 'gentler'), st('More delicate', 'gentler')], COPY, 3, OPP, WOPP).text).toBe('More fruit, lighter, and more delicate.');
    expect(match.pathSummary([st('A'), st('B')], { ...COPY, path_last_join: ' and ' }, 3, OPP, WOPP).text).toBe('A and b.');
  });
  it('a change and its opposite (moves, or more X and less X) shows no summary; more kinds than the limit shows none', () => {
    expect(match.pathSummary([st('Bolder', 'bolder'), st('Lighter', 'gentler')], COPY, 3, OPP, WOPP)).toMatchObject({ text: null, state: 'opposites' });
    expect(match.pathSummary([st('Brighter', 'gentler'), st('Bolder', 'bolder')], COPY, 3, OPP, WOPP).state).toBe('opposites');
    expect(match.pathSummary([st('Less fruit', 'different'), st('More fruit', 'different')], COPY, 3, OPP, WOPP).state).toBe('opposites');
    // not a step pair: no pattern in the words makes them opposites
    expect(match.pathSummary([st('Less fruit', 'different'), st('More fruit', 'different')], COPY, 3, OPP, new Set()).state).toBe('shown');
    expect([...WOPP].sort()).toEqual(['less fruit|more fruit', 'more fruit|less fruit']);
    expect(match.pathSummary([st('More fruit'), st('Lighter', 'gentler'), st('More delicate', 'gentler'), st('More tropical')], COPY, 3, OPP, WOPP)).toMatchObject({ text: null, state: 'over_limit' });
    expect(match.pathSummary([st('More fruit'), st('Lighter', 'gentler'), st('More delicate', 'gentler'), st('More tropical')], COPY, 4, OPP, WOPP).state).toBe('shown');
  });
  it('the tag by distance: your spot, one step, n steps, outside the comfort zone, no way', () => {
    expect(match.distanceTag(0, 1, COPY).text).toBe('Your spot');
    expect(match.distanceTag(1, 1, COPY).text).toBe(ONE);
    expect(match.distanceTag(2, 1, COPY).text).toBe(OUT(2));
    expect(match.distanceTag(2, 2, COPY).text).toBe('2 steps from your spot');
    expect(match.distanceTag(3, 2, COPY).text).toBe(OUT(3));
    expect(match.distanceTag(null, 1, COPY)).toEqual({ code: 'no_way', text: 'A different part of the map' });
  });
});

describe('the distance on the test map', () => {
  it('for every pair: the fewest shown steps (a plain search agrees), and Tiger Stripe as Dana walks it', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const pairs = [...(await dialReads.activeStepWords(c)).values()];
      const opp = await dialReads.moveOpposites(c);
      const coffees = (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement`)).rows.map(r => r.coffee_id);
      let checked = 0;
      for (const spot of coffees) {
        const ways = match.shortestWays(spot, pairs, opp);
        const dist = new Map([[spot, 0]]); const q = [spot];
        while (q.length) { const at = q.shift()!; for (const s of pairs) if (s.from_coffee_id === at && !dist.has(s.to_coffee_id)) { dist.set(s.to_coffee_id, dist.get(at)! + 1); q.push(s.to_coffee_id); } }
        for (const to of coffees) {
          expect(ways.get(to)?.length ?? null).toBe(dist.get(to) ?? null);
          const w = ways.get(to);
          if (w && w.length) { expect(w[0].from_coffee_id).toBe(spot); expect(w[w.length - 1].to_coffee_id).toBe(to); }
          checked++;
        }
      }
      expect(checked).toBe(coffees.length * coffees.length);
      const tiger = match.shortestWays(await placedId(c, 'Tiger Stripe'), pairs, opp);
      const d = async (n: string) => tiger.get(await placedId(c, n))?.length ?? null;
      expect([await d('The Daily'), await d('Amsterdam'), await d('Great Heights'), await d('Big City'), await d('Half Moon')]).toEqual([1, 2, 3, 4, null]);
      // Dana Q1 (b): among equally short ways, the one with no opposite: Brazil by Fabricator, not by Blossom
      expect((tiger.get(await placedId(c, 'Brazil')) ?? []).map(s => s.button_word)).toEqual(['Lighter', 'Simpler']);
    });
  });
  it('no summary on the map repeats a word, and two coffees share a summary only when reached by the same kinds of change', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const pairs = [...(await dialReads.activeStepWords(c)).values()];
      const opp = await dialReads.moveOpposites(c);
      const copy = await dialReads.customerCopy(c);
      const coffees = (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement`)).rows.map(r => r.coffee_id);
      const kindsBy = new Map<string, Set<string>>();
      for (const spot of coffees) for (const [to, w] of match.shortestWays(spot, pairs, opp)) {
        if (to === spot || w.length < 2) continue;
        const s = match.pathSummary(w, copy, 3, opp, match.stepWordOpposites(pairs));
        if (!s.text) continue;
        expect(new Set(s.words).size).toBe(s.words.length);
        const kinds = s.words.join('+');
        if (!kindsBy.has(s.text)) kindsBy.set(s.text, new Set());
        kindsBy.get(s.text)!.add(kinds);
      }
      for (const [text, kinds] of kindsBy) expect([text, kinds.size]).toEqual([text, 1]);
    });
  });
});

describe('the seed (Data 1 to 3, through the writers)', () => {
  it('the five rows are off, "More body, keep the fruit" is "More body" with its line kept, no placement moves; a second run writes nothing', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const again = await applyMeasured(tx(c));
      expect(again.written).toBe(0);
      expect(again.published).toBeNull();
      const plan = await planMeasured(tx(c));
      expect(plan.rows.filter(r => r.action === 'write')).toEqual([]);
      const rows = (await c.query<{ kind_code: string; code: string; is_active: boolean }>(`SELECT kind_code, code, is_active FROM v_dial_reason_choice WHERE is_current`)).rows;
      for (const o of OFF) expect(rows.find(r => r.kind_code === o.kind && r.code === o.code)?.is_active).toBe(false);
      expect(rows.find(r => r.code === 'family_lean')?.is_active).toBe(true);
      const s = (await c.query<{ button_word: string; customer_line: string; move_code: string }>(
        `SELECT button_word, customer_line, move_code FROM v_dial_step WHERE on_active_map AND from_coffee_id = $1 AND to_coffee_id = $2`,
        [await placedId(c, 'La Familia'), await placedId(c, 'Geometric')])).rows[0];
      expect(s).toEqual({ button_word: 'More body', customer_line: 'Keeps the fruit of {from} and adds weight: bright fruit over caramel.', move_code: 'bolder' });
      expect(Number((await c.query(`SELECT count(*) AS n FROM v_dial_step WHERE on_active_map AND button_word LIKE '%,%'`)).rows[0].n)).toBe(0);
    });
  });
});

describe("Dana's pages (CLOSING_REPORT_16.md, item 4 as built)", () => {
  it('the spot page is as today: the same top card and step sentences, the lead, no distance tags', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const r = await page(c, await danaLike(c));
      expect(r.lookingAt).toBe(false);
      expect(r.firstBag!.text).toBe('Coffee should feel like a reward for you: warm, rich, comforting. A little bitterness tastes serious to you. Chocolate first, with a little lift. Built for espresso.');
      expect(r.steps.map(s => [s.name, s.isLead, s.tag, s.text])).toEqual([
        ['Blossom', true, null, 'For you, a good cup is strong and satisfying. A darker roast than Tiger Stripe, with a fuller body.'],
        ['Geometric', false, null, "Next to your coffee, you'd reach for something fresh and lively. More fruit than Tiger Stripe: fruit comes first here, sweeter and lighter, with the chocolate behind it."],
        ['The Daily', false, null, "Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite."],
        ['Fabricator', false, null, 'You taste a black coffee first, then make it richer. Tiger Stripe with a different accent: hazelnut, citrus and cinnamon where the cherry was, in a lighter body.'],
        ['The Waverly', false, null, 'A coffee with no bitterness would bother you. Close to Tiger Stripe: chocolate underneath, with more fruit on top, fig and orange.'],
      ]);
    });
  });
  it('a one-step coffee says exactly what its spot-page card says, for every one-step coffee', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const dana = await danaLike(c);
      const spot = await page(c, dana);
      for (const card of spot.steps) {
        const r = await match.steps(dana, c, { withBasis: true, at: card.coffeeId });
        expect([card.name, r.firstBag!.tag, r.firstBag!.text]).toEqual([card.name, ONE, card.text]);
        expect(r.firstBag!.basis!.factCodes).toEqual(card.basis!.factCodes);
      }
    });
  }, 900_000);
  it('the walk Tiger Stripe, The Daily, Amsterdam, Great Heights, Big City: the count rises by one, outside from Amsterdam on; the summaries', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const dana = await danaLike(c);
      const walk = [];
      for (const at of ['The Daily', 'Amsterdam', 'Great Heights', 'Big City']) { const r = await page(c, dana, at); walk.push([at, r.firstBag!.tag, r.firstBag!.text]); }
      expect(walk).toEqual([
        ['The Daily', ONE, "Coffee is a daily ritual for you, and you're particular about it. Tiger Stripe without the fruit: chocolate and caramel, with a bit more bite."],
        ['Amsterdam', OUT(2), 'Less fruit, and bolder. Deep and smooth, with dark chocolate and walnut.'],
        ['Great Heights', OUT(3), 'Less fruit, and much bolder. The same idea as Amsterdam, roasted darker.'],
        ['Big City', OUT(4), 'Less fruit, and far bolder. French roast and burnt sugar.'],
      ]);
      const bench = await page(c, dana, 'Benchmark');
      expect([bench.firstBag!.tag, bench.firstBag!.text]).toEqual([OUT(2), 'Less fruit, and lighter. This is the cup where nothing sticks out: pure chocolate, round and soft.']);
      const village = await page(c, dana, 'The Village');
      expect([village.firstBag!.tag, village.firstBag!.text]).toEqual([OUT(3), 'More fruit, lighter, and more delicate. Floral, with apple blossom and grapefruit.']);
      const brazil = await page(c, dana, 'Brazil');
      expect(brazil.firstBag!.text).toBe('Lighter, and simpler. The base on its own: chocolate, almond and honey.');
      // more delicate and more tropical are the two directions of one step pair (Dana 2026-11-28): no summary, the tag and the coffee's own line only
      const fem = await page(c, dana, 'Cafè Feminista');
      expect([fem.firstBag!.tag, fem.firstBag!.text, fem.firstBag!.basis!.summary]).toEqual([OUT(4), 'Soft and tropical, with papaya and candied coconut.', 'opposites']);
      expect(fem.firstBag!.basis!.way!.map(w => w.word)).toEqual(['More fruit', 'Lighter', 'More delicate', 'More tropical']);
    });
  });
  it('while looking: no lead, every step card is its line alone with its distance from the spot, and no quiz answer outside the comfort zone', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const dana = await danaLike(c);
      const said = await saidOf(c);
      // every coffee /map lets a regular customer open: placed, active, not decaf (the same test as steps)
      const coffees = (await dialReads.placementActive(c) as Array<{ coffee_id: number; category_codes: string[] | null; coffee_is_active: boolean }>)
        .filter(r => r.coffee_is_active && match.passesTagFilter(r.category_codes, false));
      const tiger = await placedId(c, 'Tiger Stripe');
      for (const { coffee_id: at } of coffees) {
        if (at === tiger) continue;
        const r = await match.steps(dana, c, { withBasis: true, at });
        expect(r.steps.some(s => s.isLead)).toBe(false);
        for (const s of r.steps) {
          expect(s.basis!.factCodes).toEqual([]);
          expect(s.text.replace(/\.$/, '')).toBe((s.line ?? '').replace(/\.$/, ''));
          expect(s.tag).not.toBeNull();
          if (s.coffeeId === tiger) expect(s.tag).toBe('Your spot');
          for (const p of said) expect(s.text.includes(p)).toBe(false);
        }
        if ((r.firstBag!.basis!.distance ?? 9) > 1) for (const p of said) expect(r.firstBag!.text.includes(p)).toBe(false);
      }
      const fab = await page(c, dana, 'Fabricator');
      expect(fab.steps.map(s => [s.name, s.tag])).toEqual([
        ['Geometric', ONE], ['Brazil', OUT(2)], ['Tiger Stripe', 'Your spot'], ['Benchmark', OUT(2)]]);
    });
  }, 900_000);
  it('the comfort zone at 2 moves the label out by one step on the next read; at 1 again it is back', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const dana = await danaLike(c);
      await setParameterInTx(tx(c), { key: 'dial_path_comfort_zone_steps', value: 2, adminId: 'zzz-map16' });
      const ams = await page(c, dana, 'Amsterdam');
      expect([ams.firstBag!.tag, ams.firstBag!.text]).toEqual(['2 steps from your spot', 'Less fruit, and bolder. Deep and smooth, with dark chocolate and walnut.']);
      expect((await page(c, dana, 'Great Heights')).firstBag!.tag).toBe(OUT(3));
      await setParameterInTx(tx(c), { key: 'dial_path_comfort_zone_steps', value: 1, adminId: 'zzz-map16' });
      expect((await page(c, dana, 'Amsterdam')).firstBag!.tag).toBe(OUT(2));
    });
  });
  it('a coffee with no way to it: a regular customer cannot open the decaf island; the tag would be the no-way row', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const dana = await danaLike(c);
      await expect(page(c, dana, 'Half Moon')).rejects.toMatchObject({ status: 404, code: 'NOT_ON_MAP' });
      const copy = await dialReads.customerCopy(c);
      expect(match.distanceTag(null, 1, copy).text).toBe('A different part of the map');
    });
  });
});

describe('integrity', () => {
  it('the copy rows and the two parameters are present (checks 9 and 10)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensure16(c);
      const failed = (await dialMapChecks(c)).filter(x => !x.pass).map(x => `${x.id}: ${(x.details ?? []).join(' ')}`).join(' | ');
      expect(failed).not.toMatch(/tag_steps|tag_outside|tag_no_way|path_|dial_path_/);
    });
  });
});
