// Ella's Bloom Map 14 (2026-11-27), Part D: what moves your spot, and walking
// the map. Every pinned case of the brief, looking at a coffee writes nothing,
// a coffee off the map is refused for at, a row switched off changes the spot
// on the next read, the sentiment limits give the same labels as the 4 and 2
// they replace, a member's bag ordered by someone else counts for the member,
// and the lead rules (the spot is never the lead while looking elsewhere; a
// disliked coffee is never the lead). Test DB only, every test inside a
// rolled-back transaction; marked 'Zzz Map14' fixtures. Facts are inserted the
// way the earlier map tests insert them (decisions, orders and feedback with
// explicit times; one transaction has one now()).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { getMatchCurrent, getSpotTrail } from './customerReads.js';
import { setSpotEventInTx } from './dialPlacementService.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyRev2 } from '../scripts/ellaMapReasonsRev2_2026_11_23.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';
import { applyComparisons } from '../scripts/ellaMapStepComparisons_2026_11_25.js';
import { applySpot, planSpot } from '../scripts/ellaMapSpot_2026_11_26.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;
const T0 = Date.parse('2026-11-01T12:00:00Z');
/** a time n hours after the quiz */
const at = (hours: number) => new Date(T0 + hours * 3_600_000).toISOString();

async function coffee(c: pg.PoolClient, mapName: string): Promise<number> {
  const r = await c.query<{ coffee_id: number }>(
    `SELECT p.coffee_id FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id WHERE a.map_name = $1`, [mapName]);
  if (!r.rows[0]) throw new Error(`no coffee on the active map named ${mapName}`);
  return r.rows[0].coffee_id;
}
async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map14') RETURNING id`, [`zzz-map14-${randomUUID()}`])).rows[0].id;
}
async function activeVersion(c: pg.PoolClient) {
  return (await c.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0].id;
}
/** A decision row, as dialMap12 inserts them: quiz_result (the Founder's pick) or a map step. */
async function decision(c: pg.PoolClient, userId: string, move: 'quiz_result' | 'step' | 'stay', coffeeId: number, when: string, inputs: object = {}) {
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, picked_coffee_id, source, source_id, inputs)
     SELECT $1, $2, $3, m.id, $4, $5, $6, $7 FROM dial_move m WHERE m.code = $8`,
    [userId, when, await activeVersion(c), coffeeId, move === 'quiz_result' ? 'quiz' : 'map', `zzz-map14-${randomUUID()}`, JSON.stringify(inputs), move]);
}
/** One real (live, paid) order with one line of the coffee; quantity bags; for the drinker (intended_for). */
async function order(c: pg.PoolClient, o: { buyer: string; drinker?: string; coffeeId: number; when: string; quantity?: number; kind?: string; mode?: 'live' | 'test'; lines?: number }) {
  const orderId = (await c.query<{ id: string }>(
    `INSERT INTO "order" (user_id, total_amount_paid, paid_at, created_at, stripe_mode) VALUES ($1, 29, $2, $2, $3) RETURNING id`,
    [o.buyer, o.when, o.mode ?? 'live'])).rows[0].id;
  const sku = (await c.query<{ id: string }>(`SELECT id FROM coffee_sku WHERE coffee_id = $1 ORDER BY is_active DESC, id LIMIT 1`, [o.coffeeId])).rows[0].id;
  let lineId = '';
  for (let i = 0; i < (o.lines ?? 1); i++) {
    lineId = (await c.query<{ id: string }>(
      `INSERT INTO order_line_item (order_id, blend_id, quantity, intended_for_user_id, order_kind) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orderId, sku, o.quantity ?? 1, o.drinker ?? o.buyer, o.kind ?? 'manual'])).rows[0].id;
  }
  await c.query(`INSERT INTO order_event (order_id, event_kind, payment_status, source, created_at) VALUES ($1, 'paid', 'paid', 'webhook', $2)`, [orderId, o.when]);
  return { orderId, lineId };
}
/** The customer's own feedback on a coffee, at a time. */
async function feedback(c: pg.PoolClient, userId: string, coffeeId: number, rating: number | null, when: string, rawText: string | null = null) {
  await c.query(
    `INSERT INTO customer_feedback_event (user_id, occurred_at, recorded_at, source, source_id, coffee_id, rating, raw_text, channel)
     VALUES ($1, $2, $2, 'onsite', $3, $4, $5, $6, 'onsite')`,
    [userId, when, `zzz-map14-${randomUUID()}`, coffeeId, rating, rawText]);
}
async function spot(c: pg.PoolClient, userId: string) {
  const p = await getMatchCurrent(userId, c);
  return p ? { coffeeId: p.coffeeId, basis: p.spotEventCode } : null;
}

describe('the pinned cases (brief: start on the quiz result Tiger Stripe)', () => {
  type Case = { name: string; spot: 'Tiger Stripe' | 'Blossom' | 'Benchmark'; basis: string; given: (c: pg.PoolClient, u: string, k: Record<string, number>) => Promise<void> };
  const cases: Case[] = [
    { name: 'nothing', spot: 'Tiger Stripe', basis: 'founders_pick', given: async () => {} },
    { name: 'map step decisions to Blossom and on (old rows)', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await decision(c, u, 'step', k.Blossom, at(1)); await decision(c, u, 'step', k.Brazil, at(2)); await decision(c, u, 'stay', k.Brazil, at(3));
    } },
    { name: 'Blossom in the cart (no fact: the cart writes nothing)', spot: 'Tiger Stripe', basis: 'founders_pick', given: async () => {} },
    { name: 'orders Blossom once', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => { await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); } },
    { name: 'rates Tiger 5, orders Blossom, rates Blossom 4', spot: 'Tiger Stripe', basis: 'feedback_positive', given: async (c, u, k) => {
      await feedback(c, u, k.Tiger, 5, at(1)); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2) }); await feedback(c, u, k.Blossom, 4, at(3));
    } },
    { name: 'orders Blossom, rates Blossom 4, Tiger never rated', spot: 'Blossom', basis: 'feedback_positive', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await feedback(c, u, k.Blossom, 4, at(2));
    } },
    { name: 'orders Blossom twice, in two orders', spot: 'Blossom', basis: 'reorder', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2) });
    } },
    { name: 'two bags of Blossom in one order (quantity 2, and two lines)', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1), quantity: 2 }); await order(c, { buyer: u, coffeeId: k.Brazil, when: at(2), lines: 2 });
    } },
    { name: 'orders Blossom, rates it 2', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await feedback(c, u, k.Blossom, 2, at(2));
    } },
    { name: 'rates Tiger 2, nothing else', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => { await feedback(c, u, k.Tiger, 2, at(1)); } },
    { name: 'spot moved to Blossom by a reorder, then a quiz retake gives Benchmark', spot: 'Blossom', basis: 'reorder', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2) });
      await decision(c, u, 'quiz_result', k.Benchmark, at(3));
    } },
    { name: 'no order or feedback, quiz retake gives Benchmark', spot: 'Benchmark', basis: 'founders_pick', given: async (c, u, k) => { await decision(c, u, 'quiz_result', k.Benchmark, at(3)); } },
    { name: 'a subscription renewal ships Blossom twice', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1), kind: 'subscription_renewal' }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2), kind: 'subscription_renewal' });
    } },
    { name: 'reorder row switched off, orders Blossom twice', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await setSpotEventInTx(tx(c), { code: 'reorder', isActive: false, adminUid: 'zzz-map14' });
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2) });
    } },
    // the brief's other rules, beside the pinned table
    { name: 'a test-mode order does not count (twice, test mode)', spot: 'Tiger Stripe', basis: 'founders_pick', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1), mode: 'test' }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2), mode: 'test' });
    } },
    { name: 'equal ratings move the spot (F1): Tiger 4, then Blossom 4', spot: 'Blossom', basis: 'feedback_positive', given: async (c, u, k) => {
      await feedback(c, u, k.Tiger, 4, at(1)); await feedback(c, u, k.Blossom, 4, at(2));
    } },
    { name: 'positive feedback on the spot\'s own coffee makes it the basis (F2); a retake then does not move it', spot: 'Tiger Stripe', basis: 'feedback_positive', given: async (c, u, k) => {
      await feedback(c, u, k.Tiger, 5, at(1)); await decision(c, u, 'quiz_result', k.Benchmark, at(2));
    } },
    { name: 'a liam_followed order counts toward a reorder', spot: 'Blossom', basis: 'reorder', given: async (c, u, k) => {
      await order(c, { buyer: u, coffeeId: k.Blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: k.Blossom, when: at(2), kind: 'liam_followed' });
    } },
  ];
  for (const k of cases) {
    it(`${k.name} -> ${k.spot} · ${k.basis}`, async () => {
      await withRollback(async ({ client: c }) => {
        const ids = { Tiger: await coffee(c, 'Tiger Stripe'), Blossom: await coffee(c, 'Blossom'), Brazil: await coffee(c, 'Brazil'), Benchmark: await coffee(c, 'Benchmark') };
        const u = await newProfile(c);
        await decision(c, u, 'quiz_result', ids.Tiger, at(0));
        await k.given(c, u, ids);
        const want = k.spot === 'Tiger Stripe' ? ids.Tiger : k.spot === 'Blossom' ? ids.Blossom : ids.Benchmark;
        expect(await spot(c, u)).toEqual({ coffeeId: want, basis: k.basis });
      });
    });
  }

  it('no quiz result, no spot: orders and feedback alone never make one', async () => {
    await withRollback(async ({ client: c }) => {
      const blossom = await coffee(c, 'Blossom');
      const u = await newProfile(c);
      await order(c, { buyer: u, coffeeId: blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: blossom, when: at(2) });
      await feedback(c, u, blossom, 5, at(3));
      expect(await spot(c, u)).toBeNull();
    });
  });

  it("a member's bag ordered by the household admin counts for the member (two orders: the member's reorder)", async () => {
    await withRollback(async ({ client: c }) => {
      const [tiger, blossom] = [await coffee(c, 'Tiger Stripe'), await coffee(c, 'Blossom')];
      const admin = await newProfile(c);
      const member = await newProfile(c);
      await decision(c, admin, 'quiz_result', tiger, at(0));
      await decision(c, member, 'quiz_result', tiger, at(0));
      await order(c, { buyer: admin, drinker: member, coffeeId: blossom, when: at(1) });
      await order(c, { buyer: admin, drinker: member, coffeeId: blossom, when: at(2) });
      expect(await spot(c, member)).toEqual({ coffeeId: blossom, basis: 'reorder' });
      expect(await spot(c, admin)).toEqual({ coffeeId: tiger, basis: 'founders_pick' });
    });
  });

  it('switching a row off changes the spot on the next read, and on again brings it back', async () => {
    await withRollback(async ({ client: c }) => {
      const [tiger, blossom] = [await coffee(c, 'Tiger Stripe'), await coffee(c, 'Blossom')];
      const u = await newProfile(c);
      await decision(c, u, 'quiz_result', tiger, at(0));
      await order(c, { buyer: u, coffeeId: blossom, when: at(1) }); await order(c, { buyer: u, coffeeId: blossom, when: at(2) });
      expect((await spot(c, u))!.coffeeId).toBe(blossom);
      await setSpotEventInTx(tx(c), { code: 'reorder', isActive: false, adminUid: 'zzz-map14' });
      expect(await spot(c, u)).toEqual({ coffeeId: tiger, basis: 'founders_pick' });
      await setSpotEventInTx(tx(c), { code: 'reorder', isActive: true, adminUid: 'zzz-map14' });
      expect(await spot(c, u)).toEqual({ coffeeId: blossom, basis: 'reorder' });
      // the reorder count is a parameter: at 3, two orders are no reorder
      await setParameterInTx(tx(c), { key: 'dial_spot_reorder_count', value: 3, adminId: 'zzz-map14' });
      expect(await spot(c, u)).toEqual({ coffeeId: tiger, basis: 'founders_pick' });
    });
  });
});

describe('the trail: a short true history', () => {
  it('Founder\'s pick, Ordered, the customer\'s words, Your spot moved here; no map tap; hasBag is a real order', async () => {
    await withRollback(async ({ client: c }) => {
      const [tiger, blossom] = [await coffee(c, 'Tiger Stripe'), await coffee(c, 'Blossom')];
      const u = await newProfile(c);
      await decision(c, u, 'quiz_result', tiger, at(0));
      await decision(c, u, 'step', blossom, at(0.5));
      const before = await match.steps(u, c);
      expect(before.position!.hasBag).toBe(false);
      await order(c, { buyer: u, coffeeId: blossom, when: at(1) });
      await feedback(c, u, blossom, 4, at(2), 'Lovely with milk.');
      const me = await match.me(u, c);
      const copy = me.copy;
      expect(me.trail.map(t => [t.move, t.moveWord])).toEqual([
        ['founders_pick', "Founder's pick"], ['first_order', 'Ordered'], ['feedback_positive', 'You said'],
      ]);
      expect(me.trail[2].line).toBe('Lovely with milk.');
      expect(me.trail[2].moved).toBe(true);
      expect(me.trail[2].movedLine).toBe(copy.trail_moved);
      expect(me.trail[1].moved).toBe(false);
      expect(me.position!.coffeeId).toBe(blossom);
      expect(me.position!.basis).toBe('feedback_positive');
      const after = await match.steps(u, c);
      expect(after.position!.hasBag).toBe(true);
      expect(after.startCoffeeId).toBe(tiger);
      expect(after.spot).toMatchObject({ coffeeId: blossom, basis: 'feedback_positive' });
    });
  });
});

describe('the sentiment limits are parameters, same labels as the 4 and 2 they replace', () => {
  it('ratings 1 to 5 and none: v_customer_feedback_current and v_customer_timeline give the old labels', async () => {
    await withRollback(async ({ client: c }) => {
      const blossom = await coffee(c, 'Blossom');
      const old = (r: number | null) => (r === null ? 'neutral' : r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral');
      for (const r of [1, 2, 3, 4, 5, null]) {
        const u = await newProfile(c);
        await feedback(c, u, blossom, r, at(1));
        const cur = (await c.query<{ sentiment: string }>(
          `SELECT f.sentiment FROM v_customer_feedback_current f JOIN v_customer_identity v ON v.canonical_user_id = f.canonical_user_id WHERE v.user_id = $1`, [u])).rows;
        expect(cur.map(x => x.sentiment)).toEqual([old(r)]);
        const tl = (await c.query<{ s: string }>(
          `SELECT t.detail->>'sentiment' AS s FROM v_customer_timeline t JOIN v_customer_identity v ON v.canonical_user_id = t.canonical_user_id WHERE v.user_id = $1 AND t.kind = 'feedback'`, [u])).rows;
        expect(tl.map(x => x.s)).toEqual([old(r)]);
      }
    });
  });

  it('moving a limit moves the label (the view reads the parameter)', async () => {
    await withRollback(async ({ client: c }) => {
      const blossom = await coffee(c, 'Blossom');
      const u = await newProfile(c);
      await feedback(c, u, blossom, 4, at(1));
      await setParameterInTx(tx(c), { key: 'feedback_positive_min_rating', value: 5, adminId: 'zzz-map14' });
      const s = (await c.query<{ sentiment: string }>(
        `SELECT f.sentiment FROM v_customer_feedback_current f JOIN v_customer_identity v ON v.canonical_user_id = f.canonical_user_id WHERE v.user_id = $1`, [u])).rows[0].sentiment;
      expect(s).toBe('neutral');
    });
  });
});

// ── Walking the map: Dana's account as dialMap10/12 build it ─────────────────

async function ensureAll(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map14 test ${randomUUID()}` });
  await applyRev2(tx(c));
  await applyComparisons(tx(c));
  await applySpot(tx(c));
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;
/** All Chocolate & Nutty answers, first match on Tiger Stripe with no rule, feeling happy (dialMap12's danaLike). */
async function danaLike(c: pg.PoolClient) {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = 'Chocolate & Nutty'`)).rows[0].id;
  const ids = [] as string[];
  for (const a of ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_c']) ids.push(await answerId(c, a));
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id)
     VALUES ($1, $2, $3, timezone('utc', now()), $4) RETURNING id`,
    [userId, arch, JSON.stringify({ archetype: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 9 }, branchedFrom: null, answerIds: ids }),
     await answerId(c, 'v7_branch_cn_stay')])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', 'Chocolate & Nutty')`, [sessionId]);
  await c.query(`INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, 'coffee_feeling', $3, 'set')`,
    [userId, `zzz-map14-${randomUUID()}`, JSON.stringify('happy')]);
  const tiger = await coffee(c, 'Tiger Stripe');
  await decision(c, userId, 'quiz_result', tiger, new Date(Date.now() - 3_600_000).toISOString(), { rule: 'derived', quiz: { session_id: sessionId } });
  return { userId, tiger };
}
/** Every row this transaction wrote, in every table (pg_stat_xact_user_tables). */
async function writesSoFar(c: pg.PoolClient) {
  return Number((await c.query(`SELECT COALESCE(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) AS n FROM pg_stat_xact_user_tables`)).rows[0].n);
}

describe('walking the map (?at=)', () => {
  it("Dana's page: on her spot Founder's pick; looking at Blossom compares to Tiger Stripe; one further shows Brazil's map_line", async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const [blossom, brazil] = [await coffee(c, 'Blossom'), await coffee(c, 'Brazil')];
      // her old taps stay in the log and move nothing
      await decision(c, p.userId, 'step', blossom, new Date(Date.now() - 1_800_000).toISOString());
      await decision(c, p.userId, 'step', brazil, new Date(Date.now() - 1_700_000).toISOString());
      const home = await match.steps(p.userId, c, { withBasis: true });
      expect(home.position!.coffeeId).toBe(p.tiger);
      expect(home.firstBag!.labelCode).toBe('founder_pick');
      expect(home.lookingAt).toBe(false);
      expect(home.steps.find(s => s.isLead)!.name).toBe('Blossom');

      const look = await match.steps(p.userId, c, { withBasis: true, at: blossom });
      expect(look.lookingAt).toBe(true);
      expect(look.position!.coffeeId).toBe(blossom);
      expect(look.spot!.coffeeId).toBe(p.tiger);
      expect(look.firstBag!.labelCode).toBe('looking_at_title');
      expect(look.firstBag!.text).toBe('A darker roast than Tiger Stripe, with a fuller body.');
      expect(look.spot!.backLine).toBe('Back to your spot: Tiger Stripe');
      for (const s of look.steps) expect(s.line).toContain('Blossom');
      // W1: her own spot is a normal card, never the lead (parameter on)
      const tigerCard = look.steps.find(s => s.coffeeId === p.tiger)!;
      expect(tigerCard).toBeDefined();
      expect(tigerCard.isLead).toBe(false);
      expect(look.steps.some(s => s.isLead)).toBe(true);
      // W2: the start rule's lead is never the lead source while looking
      expect(look.steps.filter(s => s.isLead).map(s => s.basis!.choice)).not.toContain('start_rule');

      const further = await match.steps(p.userId, c, { withBasis: true, at: brazil });
      expect(further.firstBag!.text).toBe((await c.query<{ map_line: string }>(`SELECT map_line FROM coffees WHERE id = $1`, [brazil])).rows[0].map_line);
      expect(further.spot!.coffeeId).toBe(p.tiger);
    });
  });

  it('with dial_spot_not_lead_when_looking at 0, the spot may be the lead again', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const blossom = await coffee(c, 'Blossom');
      await setParameterInTx(tx(c), { key: 'dial_spot_not_lead_when_looking', value: 0, adminId: 'zzz-map14' });
      const look = await match.steps(p.userId, c, { withBasis: true, at: blossom });
      expect(look.steps.find(s => s.isLead)!.coffeeId).toBe(p.tiger);
    });
  });

  it('a coffee rated at or below the negative limit is never the lead (and may be, with the switch at 0)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const blossom = await coffee(c, 'Blossom');
      await feedback(c, p.userId, blossom, 2, new Date(Date.now() - 600_000).toISOString());
      const r = await match.steps(p.userId, c, { withBasis: true });
      expect(r.position!.coffeeId).toBe(p.tiger);
      const lead = r.steps.find(s => s.isLead);
      expect(lead?.coffeeId).not.toBe(blossom);
      expect(r.steps.some(s => s.coffeeId === blossom)).toBe(true);
      await setParameterInTx(tx(c), { key: 'dial_spot_skip_disliked_lead', value: 0, adminId: 'zzz-map14' });
      expect((await match.steps(p.userId, c, { withBasis: true })).steps.find(s => s.isLead)!.coffeeId).toBe(blossom);
    });
  });

  it('looking at a coffee writes no row in any table; the spot, the trail and the decision log are unchanged', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const blossom = await coffee(c, 'Blossom');
      const spotBefore = await getMatchCurrent(p.userId, c);
      const trailBefore = JSON.stringify(await getSpotTrail(p.userId, c));
      const decisionsBefore = Number((await c.query(`SELECT count(*) AS n FROM customer_match_decision WHERE user_id = $1`, [p.userId])).rows[0].n);
      const w0 = await writesSoFar(c);
      await match.steps(p.userId, c, { at: blossom });
      await match.steps(p.userId, c, { at: await coffee(c, 'Brazil') });
      expect(await writesSoFar(c)).toBe(w0);
      expect(await getMatchCurrent(p.userId, c)).toEqual(spotBefore);
      expect(JSON.stringify(await getSpotTrail(p.userId, c))).toBe(trailBefore);
      expect(Number((await c.query(`SELECT count(*) AS n FROM customer_match_decision WHERE user_id = $1`, [p.userId])).rows[0].n)).toBe(decisionsBefore);
    });
  });

  it('a coffee off the active map is refused for at (404 NOT_ON_MAP)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const off = (await c.query<{ id: number }>(`SELECT id FROM coffees WHERE id NOT IN (SELECT coffee_id FROM v_dial_placement) ORDER BY id LIMIT 1`)).rows[0].id;
      await expect(match.steps(p.userId, c, { at: off })).rejects.toMatchObject({ status: 404, code: 'NOT_ON_MAP' });
    });
  });
});

describe('the rows, the seed and the integrity check', () => {
  it('check 17 passes with the seeded rows and reports an unknown code; the seed writes nothing on a second run', async () => {
    await withRollback(async ({ client: c }) => {
      await applySpot(tx(c));
      expect((await planSpot(tx(c))).rows.filter(r => r.action === 'write')).toHaveLength(0);
      const pass = (await dialMapChecks(c)).find(k => k.id === 17)!;
      expect(pass.pass).toBe(true);
      await setSpotEventInTx(tx(c), { code: 'zzz_unknown', label: 'Zzz', effectCode: 'moves_spot', adminUid: 'zzz-map14' });
      const fail = (await dialMapChecks(c)).find(k => k.id === 17)!;
      expect(fail.pass).toBe(false);
      expect((fail.details ?? []).join(' ')).toContain('zzz_unknown');
    });
  });

  it('the writer supersedes and never deletes; an unknown effect is refused', async () => {
    await withRollback(async ({ client: c }) => {
      const before = Number((await c.query(`SELECT count(*) AS n FROM dial_spot_event`)).rows[0].n);
      const r = await setSpotEventInTx(tx(c), { code: 'first_order', trailWord: 'Ordered', adminUid: 'zzz-map14' });
      expect(r.unchanged).toBe(true);
      const off = await setSpotEventInTx(tx(c), { code: 'first_order', isActive: false, adminUid: 'zzz-map14' });
      expect(off.unchanged).toBe(false);
      expect(Number((await c.query(`SELECT count(*) AS n FROM dial_spot_event`)).rows[0].n)).toBe(before + 1);
      await expect(setSpotEventInTx(tx(c), { code: 'first_order', effectCode: 'zzz', adminUid: 'zzz-map14' })).rejects.toThrow();
    });
  });
});
